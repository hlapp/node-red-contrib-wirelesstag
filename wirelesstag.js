/** @module */

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
const STATUS_NOAPI = {
    fill:"grey",
    shape:"dot",
    text:"no API config"
};

const NO_TAGMANAGER = "failed to find tag manager with MAC ";
const NO_TAG = "failed to find tag with UUID ";
const NO_SENSOR = "specified tag does not have sensor ";

module.exports = function(RED) {
    "use strict";

    var REDx = require('./setup')(RED);
    var deepAssign = require('./utils/deep-assign.js');

    /** @constructor */
    function WirelessTagNode(config) {
        REDx.nodes.createNode(this, config);

        // upgrade existing nodes with defaults for new properties
        if (config.autoUpdate === undefined) config.autoUpdate = true;
        // done upgrading existing nodes

        // set up member methods
        this.startIO = startIO;
        this.findTag = findTag;
        this.registerTag = registerTag;
        this.sendData = sendData;
        this.sendSensorData = sendSensorData;
        this.processInput = processInput;
        // done setting up member methods

        let onConnect = (platform) => {
            this.status(STATUS_CONNECTED);
            this.startIO();
        };

        let cloud = RED.nodes.getNode(config.cloud);
        if (cloud) {
            this.status(STATUS_DISCONNECTED);
            let platform = cloud.platform;
            // there are 3 cases to distinguish: (1) platform is currently
            // connecting, (2) platform is already connected, and (3) platform
            // is neither connected nor connecting. In cases (1) and (3) we
            // will watch for the connect event, and in case (2) the connect
            // event already passed, so we need to just go ahead.
            if (platform.connecting) {
                platform.on('connect', onConnect);
            } else {
                platform.isConnected().then((connected) => {
                    if (connected) {
                        return onConnect(platform);
                    } else {
                        platform.on('connect', onConnect);
                    }
                }).catch((err) => {
                    this.status(STATUS_ERROR);
                    RED.log.error(err.stack ? err.stack : err);
                });
            }
        } else {
            this.status(STATUS_NOAPI);
        }
    }

    /** @constructor */
    function WirelessTagDiscoveryNode(config) {
        WirelessTagNode.call(this, config);

        // delete options that don't pertain here
        delete config.autoUpdate;

        // add defaults for this node
        config.autoDiscover = true;
    }

    function findTag(config) {
        if (! config) config = this.config;
        let context = this.context();
        let tag = config.tag ? context.get(config.tag) : undefined;
        let findReq;
        if (tag) {
            findReq = Promise.resolve(tag);
        } else {
            let platform = RED.nodes.getNode(config.cloud).platform;
            findReq = platform.findTagManager(config.tagmanager).then((mgr) => {
                if (! mgr) throw new Error(NO_TAGMANAGER + config.tagmanager);
                return mgr.discoverTags({ uuid: config.tag });
            }).then((tags) => {
                if (tags.length === 0) throw new Error(NO_TAG + config.tag);
                context.set(tags[0].uuid, tags[0]);
                this.on('close', () => {
                    context.set(tags[0].uuid, undefined);
                });
                return tags[0];
            });
        }
        return findReq;
    }

    function startIO(node) {
        if (! node) node = this;
        let config = node.config;
        if (config.tag) {
            node.log("starting updates");
            node.findTag(config).then((tag) => {
                node.registerTag(tag);
                // send an initial message with current readings
                node.sendData(tag);
            }).catch((err) => {
                RED.log.error(err.stack ? err.stack : err);
            });
        } else if (config.autoDiscover) {
            node.log("starting updates (auto-discovery mode)");
            let tagUpdater = RED.nodes.getNode(config.cloud).tagUpdater;
            let dataHandler = sendData.bind(node);
            tagUpdater.on('data', dataHandler);
            tagUpdater.discoveryMode = true;
            node.on('close', () => {
                node.log("stopping auto-discovery mode updates");
                tagUpdater.discoveryMode = false;
                tagUpdater.removeListener('data', dataHandler);
            });
        }
        node.on('input', processInput.bind(node));
    }

    function registerTag(tag) {
        let node = this;
        let config = node.config;
        tag.on('data', sendData.bind(node));
        if (config.autoUpdate) {
            let tagUpdater = RED.nodes.getNode(config.cloud).tagUpdater;
            tagUpdater.addTags(tag);
            node.on('close', () => {
                node.log("stopping updates");
                tagUpdater.removeTags(tag);
            });
        }
    }

    function sendData(tag) {
        let node = this;
        let config = node.config;
        tag.discoverSensors().then((sensors) => {
            if (config.sensor) {
                sensors = sensors.filter(s => s.sensorType === config.sensor);
                if (sensors.length === 0) {
                    throw new Error(NO_SENSOR + config.sensor);
                }
            }
            node.status(STATUS_DATA);
            sensors.forEach( (sensor) => node.sendSensorData(sensor) );
            setTimeout(node.status.bind(node, STATUS_CONNECTED), 1000);
        });
    }

    function sendSensorData(sensor) {
        let node = this;
        let config = node.config;
        let msg = {
            payload: {
                sensor: sensor.sensorType,
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
        node.debug("sending: " + JSON.stringify(msg));
        node.send(msg);
    }

    function processInput(msg) {
        let node = this;
        let config = node.config;
        if (! config.tag) {
            if ((msg.tag.uuid || msg.tag.slaveId) === undefined) {
                node.error("tag not specified in input, cannot process", msg);
                return;
            }
            config = {
                tag: msg.tag.uuid || msg.tag.slaveId,
                tagmanager: msg.tagManager.mac,
                sensor: msg.payload.sensor,
                cloud: config.cloud
            };
            // in auto-discover mode we default to immediate updates
            // because the polling API already gets updates from the cloud
            if (config.autoDiscover && msg.payload.immediate !== false) {
                msg.payload.immediate = true;
            }
        }
        let findReq = node.findTag(config).then(tag => tag.discoverSensors());
        findReq.then((sensors) => {
            if (config.sensor) {
                sensors = sensors.filter(s => s.sensorType === config.sensor);
            }
            let tag = sensors[0].wirelessTag;
            let sensor = sensors.length === 1 ? sensors[0] : undefined;
            node.status(STATUS_PROCESSING);
            processIncomingMsg(msg, sensor, tag);
        }).catch((err) => {
            node.error("error processing message: " + err, msg);
        }).then(() => {
            node.status(STATUS_CONNECTED);
        });
    }

    function processIncomingMsg(msg, sensor, tag) {
        let sentinel = (success) => success(sensor);
        let req = { 'then': sentinel, 'catch': function() {}};
        if (! tag) tag = sensor.wirelessTag;

        // arm/disarm sensor if requested
        if (msg.payload.armed !== undefined) {
            req = req.then(() => {
                if (! sensor) throw new Error("must give sensor for arm/disarm");
                return msg.payload.armed ? sensor.arm() : sensor.disarm();
            });
        }
        // save sensor's updated monitoring config properties as requested
        let sensorProps = msg.payload.sensorConfig;
        if (sensorProps) {
            req = req.then(() => {
                if (! sensor) throw new Error("must give sensor for updating sensor config");
                return sensor.monitoringConfig().update();
            }).then((config) => {
                return deepAssign(config, sensorProps).save();
            });
        }
        // update tag properties if requested - currently only updateInterval
        let tagProps = msg.payload.tag || msg.tag;
        let newValue = tagProps ? tagProps.updateInterval : undefined;
        if (newValue !== undefined) {
            req = req.then(() => {
                return tag.setUpdateInterval(newValue);
            });
        }
        // if nothing matched as actionable, treat it as trigger to update tag
        if (req.then === sentinel) {
            req = msg.payload.immediate ? tag.liveUpdate() : tag.update();
        }
        return req;
    }

    RED.nodes.registerType("wirelesstag", WirelessTagNode);
    RED.nodes.registerType("wirelesstag-all", WirelessTagDiscoveryNode);
};
