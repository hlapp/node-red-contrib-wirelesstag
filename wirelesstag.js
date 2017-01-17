/** @module */

module.exports = function(RED) {
    "use strict";

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
        RED.nodes.createNode(this, config);
        var cloud = RED.nodes.getNode(config.cloud);
        if (cloud) {
            this.platform = cloud.platform;
            if (! tagUpdaters[config.cloud]) {
                tagUpdaters[config.cloud] = new TagUpdater(this.platform);
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
            updater.startUpdateLoop();
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
            payload: { reading: sensor.reading, eventState: sensor.eventState }
        };
        node.log("data: " + JSON.stringify(msg));
        node.status(STATUS_DATA);
        node.send(msg);
        setTimeout(node.status.bind(node, STATUS_CONNECTED), 1000);
    }

    RED.nodes.registerType("wirelesstag", WirelessTagNode);
};
