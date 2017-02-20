"use strict";

module.exports = function(RED) {

    // a function to override RED.nodes.createNode to add missing pieces
    function createNode(node, def) {
        RED.nodes.createNode(node, def);

        // add the missing Node.debug()
        if (! node.debug) { 
            node.debug = function(msg) {
                // the following is adapted from the (unfortunately unexposed)
                // log_helper() in node-red/red/runtime/nodes/Node.js
                let o = {
                    level: RED.log.DEBUG,
                    id: this.id,
                    type: this.type,
                    msg: msg
                };
                if (this.name) {
                    o.name = this.name;
                }
                RED.log.log(o);
            };
        }

        // add the missing node.config
        if (! node.config) {
            Object.defineProperty(node, "config", {
                enumerable: true,
                value: def
            });
        }
    }
    return {
        nodes: {
            createNode: createNode
        }
    };
};
