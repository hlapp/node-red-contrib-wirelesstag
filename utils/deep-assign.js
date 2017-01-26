"use strict";

module.exports = function deepAssign(target, source) {
    if (! (target && source)) return target;
    Object.keys(source).forEach((p) => {
        // ignore properties that do not exist in the target
        if (! target.hasOwnProperty(p)) return;
        let sval = source[p];
        // ignore functions
        if ('function' === typeof value) return;
        // types must be consistent
        let tval = target[p];
        if (tval && sval && (typeof tval !== typeof sval)) {
            throw new TypeError("inconsistent type of property " + p);
        }
        if ('object' === typeof sval) {
            deepAssign(tval, sval);
        } else if (Array.isArray(sval)) {
            deepAssign(tval, sval);
        } else {
            target[p] = sval;
        }
    });
    return target;
};
