module.exports = function(RED) {
    "use strict";

    var Platform = require('wirelesstags');

    /** @constructor */
    function WirelessTagConfig(config) {
        RED.nodes.createNode(this, config);
        this.platform = new Platform({ apiBaseURI: config.api_uri });
        this.platform.connect(this.credentials).then(() => {
            this.log("connected to Wireless Tag Cloud");
            addWirelesstagRoutes(RED.httpNode, this);
        }).catch((err) => {
            if (err instanceof Platform.UnauthorizedAccessError) {
                this.error("failed to connect to Wireless Tag API:");
            }
            this.error(err.stack ? err.stack : err);
        });
    }

    function addWirelesstagRoutes(app, platformNode) {
        let prefix = '/wirelesstag/' + platformNode.id;
        let platform = platformNode.platform;

        function apiError(res) {
            return (err) => {
                platformNode.error(err.stack ? err.stack : err);
                if (err.apiStatusCode && err.apiStatusCode > 200) {
                    res.status(err.apiStatusCode).send(err.message);
                } else {
                    res.status(500).send(err.message);
                }
            };
        }

        app.get(prefix + '/tagmanagers', (req, res) => {
            platform.connect(platformNode.credentials).then(() => {
                return platform.discoverTagManagers();
            }).then((managers) => {
                let macMap = {};
                managers.forEach((mgr) => { macMap[mgr.mac] = mgr.name; });
                res.send(macMap);
            }).catch(apiError(res));
        });
        app.get(prefix + '/:mgr/tags', (req, res) => {
            platform.connect(platformNode.credentials).then(() => {
                return platform.discoverTagManagers();
            }).then((managers) => {
                managers = managers.filter((m) => {
                    return m.mac === req.params.mgr;
                });
                return managers[0].discoverTags();
            }).then((tags) => {
                let uuidMap = {};
                tags.forEach((tag) => { uuidMap[tag.uuid] = tag.name; });
                res.send(uuidMap);
            }).catch(apiError(res));
        });
        app.get(prefix + '/:mac/:tag/sensors', (req, res) => {
            platform.connect(platformNode.credentials).then(() => {
                return platform.discoverTagManagers();
            }).then((managers) => {
                managers = managers.filter((m) => {
                    return m.mac === req.params.mac;
                });
                return managers[0].discoverTags({ uuid: req.params.tag });
            }).then((tags) => {
                res.send(tags[0].sensorCapabilities());
            }).catch(apiError(res));
        });
    }

    RED.nodes.registerType("wirelesstag-config", WirelessTagConfig, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        }
    });

    
};
