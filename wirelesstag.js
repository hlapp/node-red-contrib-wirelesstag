/** @module */

module.exports = function(RED) {
    "use strict";

    var REDx = require('./setup')(RED);

    const STATUS_CONNECTED = {
        fill:"green",
        shape:"dot",
        text:"node-red:common.status.connected"
    };
    const STATUS_DATA = {
        fill:"blue",
        shape:"dot",
        text:"node-red:common.status.connected"
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
                    startSending(this, config);
                } else {
                    platform.on('connect', () => {
                        this.status(STATUS_CONNECTED);
                        startSending(this, config);
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

    function startSending(node, config) {
        if (! config) config = node.config;
        let platform = RED.nodes.getNode(config.cloud).platform;
        platform.discoverTagManagers().then((managers) => {
            managers = managers.filter((m) => {
                return m.mac === config.tagmanager;
            });
            if (managers.length === 0) {
                throw new Error(NO_TAGMANAGER + config.tagmanager);
            }
            return managers[0].discoverTags({ uuid: config.tag });
        }).then((tags) => {
            if (tags.length === 0) throw new Error(NO_TAG + config.tag);
            return tags[0].discoverSensors();
        }).then((sensors) => {
            let sensor = sensors.filter(s => s.sensorType === config.sensor)[0];
            if (! sensor) throw new Error(NO_SENSOR + config.sensor);
            let tagUpdater = RED.nodes.getNode(config.cloud).tagUpdater;
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

    RED.nodes.registerType("wirelesstag", WirelessTagNode);
};
