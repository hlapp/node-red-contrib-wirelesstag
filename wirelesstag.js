/** @module */

module.exports = function(RED) {
    "use strict";

    var REDx = require('./setup')(RED);
    var deepAssign = require('./utils/deep-assign.js');

    const STATUS_CONNECTED = {
        fill:"green",
        shape:"dot",
        text:"node-red:common.status.connected"
    };
    const STATUS_DATA = {
        fill:"blue",
        shape:"dot",
        text:"sending data"
    };
    const STATUS_PROCESSING = {
        fill:"blue",
        shape:"ring",
        text:"processing input"
    };
    const STATUS_DISCONNECTED = {
        fill:"red",
        shape:"ring",
        text:"node-red:common.status.disconnected"
    };
    const STATUS_ERROR = {
        fill:"red",
        shape:"dot",
        text:"node-red:common.status.error"
    };

    const NO_TAGMANAGER = "failed to find tag manager with MAC ";
    const NO_TAG = "failed to find tag with UUID ";
    const NO_SENSOR = "specified tag does not have sensor ";

    /** @constructor */
    function WirelessTagNode(config) {
        REDx.nodes.createNode(this, config);
        var cloud = RED.nodes.getNode(config.cloud);
        if (cloud) {
            let platform = cloud.platform;
            platform.isConnected().then((connected) => {
                this.status(connected ? STATUS_CONNECTED : STATUS_DISCONNECTED);
                if (connected) {
                    startIO(this, config);
                } else {
                    platform.on('connect', () => {
                        this.status(STATUS_CONNECTED);
                        startIO(this, config);
                    });
                }
            }).catch((err) => {
                this.status(STATUS_ERROR);
                RED.log.error(err.stack ? err.stack : err);
            });
        } else {
            this.status({ fill:"grey", shape:"dot", text:"no API config" });
        }
    }

    function findTag(node, config) {
        if (! config) config = node.config;
        let context = node.context();
        let tag = context.get(config.tag);
        let findReq;
        if (tag) {
            findReq = Promise.resolve(tag);
        } else {
            let platform = RED.nodes.getNode(config.cloud).platform;
            findReq = platform.discoverTagManagers().then((managers) => {
                managers = managers.filter((m) => {
                    return m.mac === config.tagmanager;
                });
                if (managers.length === 0) {
                    throw new Error(NO_TAGMANAGER + config.tagmanager);
                }
                return managers[0].discoverTags({ uuid: config.tag });
            }).then((tags) => {
                if (tags.length === 0) throw new Error(NO_TAG + config.tag);
                context.set(tags[0].uuid, tags[0]);
                node.on('close', () => {
                    context.set(tags[0].uuid, undefined);
                });
                return tags[0];
            });
        }
        return findReq;
    }

    function findSensor(node, config) {
        if (! config) config = node.config;
        let findReq = findTag(node, config).then((tag) => {
            return tag.discoverSensors();
        }).then((sensors) => {
            let sensor = sensors.filter(s => s.sensorType === config.sensor)[0];
            if (! sensor) throw new Error(NO_SENSOR + config.sensor);
            return sensor;
        });
        return findReq;
    }

    function startIO(node, config) {
        startSending(node, config);
        node.on('input', (msg) => {
            findSensor(node, config).then((sensor) => {
                node.status(STATUS_PROCESSING);
                return processIncomingMsg(msg, sensor);
            }).catch((err) => {
                node.error("error processing message: " + err, msg);
            }).then(() => {
                node.status(STATUS_CONNECTED);
            });
        });
    }

    function startSending(node, config) {
        if (! config) config = node.config;
        let tagUpdater = RED.nodes.getNode(config.cloud).tagUpdater;
        findSensor(node, config).then((sensor) => {
            let tag = sensor.wirelessTag;
            sendData(node, sensor, config);
            tag.on('data', (tag) => {
                sendData(node, sensor, config);
            });
            node.log("starting updates");
            tagUpdater.addTags(tag);
            tagUpdater.startUpdateLoop((err,result) => {
                if (err) return; // errors are handled elsewhere
                if (result.value.length === 0) {
                    RED.log.debug("no updates for wirelesstag nodes");
                } else {
                    let names = result.value.map((d) => d.name).join(", ");
                    RED.log.debug("new data for " + result.value.length
                                  + " wirelesstag node(s): " + names);
                }
            });
            node.on('close', () => {
                node.log("stopping updates");
                tagUpdater.removeTags(tag);
            });
        }).catch((err) => {
            RED.log.error(err.stack ? err.stack : err);
        });
    }

    function sendData(node, sensor, config) {
        if (! config) config = node.config;
        let msg = {
            payload: {
                reading: sensor.reading,
                eventState: sensor.eventState,
                armed: sensor.isArmed()
            }
        };
        if (! msg.topic) msg.topic = config.topic || '';
        let tag = sensor.wirelessTag;
        let tagMgr = tag.wirelessTagManager;
        if (config.topicIsPrefix || (msg.topic.length === 0)) {
            msg.topic += `${tagMgr.mac}/${tag.slaveId}/${sensor.sensorType}`;
        }
        msg.sensorConfig = sensor.monitoringConfig().asJSON();
        msg.tag = {
            name: tag.name,
            uuid: tag.uuid,
            slaveId: tag.slaveId,
            alive: tag.alive,
            updateInterval: tag.updateInterval
        };
        msg.tagManager = {
            name: tagMgr.name,
            mac: tagMgr.mac,
            online: tagMgr.online
        };
        node.status(STATUS_DATA);
        node.debug("sending: " + JSON.stringify(msg));
        node.send(msg);
        setTimeout(node.status.bind(node, STATUS_CONNECTED), 1000);
    }

    function processIncomingMsg(msg, sensor) {
        let sentinel = (success) => success(sensor);
        let req = { then: sentinel };

        // Note: Below we convert for each possible action the value
        // that a promise finally resolves to the sensor object. This
        // is solely for defensive consistency, and not because
        // anything at present relies on it.

        // arm/disarm sensor if requested
        if (msg.payload.armed !== undefined) {
            req = req.then(() => {
                return msg.payload.armed ? sensor.arm() : sensor.disarm();
            });
        }
        // save sensor's updated monitoring config properties as requested
        let sensorProps = msg.payload.sensorConfig;
        if (sensorProps) {
            req = req.then(() => {
                return sensor.monitoringConfig().update();
            }).then((config) => {
                return deepAssign(config, sensorProps).save();
            }).then(() => sensor);
        }
        // update tag properties if requested - currently only updateInterval
        let tagProps = msg.payload.tag || msg.tag;
        let newValue = tagProps ? tagProps.updateInterval : undefined;
        if (newValue) {
            req = req.then(() => {
                return sensor.wirelessTag.setUpdateInterval(newValue);
            }).then(() => sensor);
        }
        // if nothing matched as actionable, treat it as trigger to update tag
        if (req.then === sentinel) {
            req = msg.payload.immediate ?
                sensor.wirelessTag.liveUpdate() : sensor.wirelessTag.update();
            req = req.then(() => sensor);
        }
        return req;
    }

    RED.nodes.registerType("wirelesstag", WirelessTagNode);
};
