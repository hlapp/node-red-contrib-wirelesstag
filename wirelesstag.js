/** @module */

module.exports = function(RED) {
    "use strict";

    var REDx = require('./setup')(RED);
    var TagUpdater = require('wirelesstags/plugins/polling-updater');
    var tagUpdaters = {};

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
            this.platform = cloud.platform;
            if (! tagUpdaters[config.cloud]) {
                this.debug("creating new tag updater");
                tagUpdaters[config.cloud] = new TagUpdater(this.platform);
            } else {
                this.debug("reusing tag updater for " + config.cloud);
            }
            this.platform.isConnected().then((connected) => {
                this.status(connected ? STATUS_CONNECTED : STATUS_DISCONNECTED);
                if (connected) {
                    startSending(this, config);
                } else {
                    this.platform.on('connect', () => {
                        this.status(STATUS_CONNECTED);
                        startSending(this, config);
                    });
                }
            }).catch((err) => {
                this.status(STATUS_ERROR);
                this.error(err.stack ? err.stack : err);
            });
        } else {
            this.status({ fill:"grey", shape:"dot", text:"no API config" });
        }
    }

    function startSending(node, config) {
        node.platform.discoverTagManagers().then((managers) => {
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
            let updater = tagUpdaters[config.cloud];
            let sensor = sensors.filter(s => s.sensorType === config.sensor)[0];
            if (! sensor) throw new Error(NO_SENSOR + config.sensor);
            let tag = sensor.wirelessTag;
            sendData(node, sensor);
            tag.on('data', (tag) => {
                sendData(node, sensor);
            });
            node.log("starting updates for tag");
            updater.addTags(tag);
            updater.startUpdateLoop((err,result) => {
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
                node.log("stopping updates for tag");
                updater.removeTags(tag);
            });
        }).catch((err) => {
            node.error(err.stack ? err.stack : err);
        });
    }

    function sendData(node, sensor) {
        let msg = {
            payload: {
                reading: sensor.reading,
                eventState: sensor.eventState,
                armed: sensor.isArmed()
            }
        };
        let tag = sensor.wirelessTag;
        let tagMgr = tag.wirelessTagManager;
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
        node.status(STATUS_DATA);
        node.send(msg);
        setTimeout(node.status.bind(node, STATUS_CONNECTED), 1000);
    }

    RED.nodes.registerType("wirelesstag", WirelessTagNode);
};
