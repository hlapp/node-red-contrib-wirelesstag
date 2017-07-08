"use strict";

module.exports = function(RED) {

    var Platform = require('wirelesstags');
    var TagUpdater = require('wirelesstags/plugins/polling-updater');

    /** @constructor */
    function WirelessTagConfig(config) {
        RED.nodes.createNode(this, config);
        this.platform = new Platform({ apiBaseURI: config.apiURI });
        this.tagUpdater = new TagUpdater(this.platform);
        this.once('close', () => {
            this.log("stopping tag updater");
            this.tagUpdater.stopUpdateLoop();
            this.platform.signoff().then(
                () => this.log("signed out of Wireless Tag cloud")
            );
        });
        this.platform.signin(this.credentials).then(() => {
            this.log("signed in to Wireless Tag Cloud");
            this.tagUpdater.startUpdateLoop((err, result) => {
                if (err) return; // errors are handled elsewhere
                if (result.value.length === 0) {
                    RED.log.debug("no updates for wirelesstag nodes");
                } else {
                    let names = result.value.map((d) => d.name).join(", ");
                    RED.log.debug("new data for " + result.value.length
                                  + " wirelesstag node(s): " + names);
                }
            });
        }).catch((err) => {
            if (err instanceof Platform.UnauthorizedAccessError) {
                this.error("failed to connect to Wireless Tag API:");
            }
            this.error(err.stack ? err.stack : err);
        });
    }

    function addWirelesstagRoutes(app) {
        let prefix = '/wirelesstag/:cloud';
        let cloud;

        function apiError(res) {
            return (err) => {
                cloud.error(err.stack ? err.stack : err);
                if (err.apiStatusCode && err.apiStatusCode > 200) {
                    res.status(err.apiStatusCode).send(err.message);
                } else {
                    res.status(500).send(err.message);
                }
            };
        }

        app.use(prefix, RED.auth.needsPermission("nodes.read"));
        app.use(prefix, (req, res, next) => {
            cloud = RED.nodes.getNode(req.params.cloud);
            if (cloud) {
                next();
            } else {
                res.status(404).send("Cloud config not deployed yet. "
                                     + "Deploy first, then resume config.");
            }
        });
        app.get(prefix + '/tagmanagers', (req, res) => {
            cloud.platform.discoverTagManagers().then((managers) => {
                let macMap = {};
                managers.forEach((mgr) => { macMap[mgr.mac] = mgr.name });
                res.send(macMap);
            }).catch(apiError(res));
        });
        app.get(prefix + '/:mgr/tags', (req, res) => {
            cloud.platform.discoverTagManagers().then((managers) => {
                managers = managers.filter((m) => m.mac === req.params.mgr);
                return managers[0].discoverTags();
            }).then((tags) => {
                let uuidMap = {};
                tags.forEach((tag) => { uuidMap[tag.uuid] = tag.name });
                res.send(uuidMap);
            }).catch(apiError(res));
        });
        app.get(prefix + '/:mac/:tag/sensors', (req, res) => {
            cloud.platform.discoverTagManagers().then((managers) => {
                managers = managers.filter((m) => m.mac === req.params.mac);
                return managers[0].discoverTags({ uuid: req.params.tag });
            }).then((tags) => {
                res.send(tags[0].sensorCapabilities());
            }).catch(apiError(res));
        });
    }

    addWirelesstagRoutes(RED.httpAdmin);

    RED.nodes.registerType("wirelesstag-config", WirelessTagConfig, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        }
    });

};
