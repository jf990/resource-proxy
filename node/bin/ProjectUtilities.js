/**
 * Project utility functions.
 * Created on 8/24/16.
 */

/**
 * Convert time in milliseconds into a printable hh:mm:ss string.
 * @param timeInMilliseconds
 * @returns {string}
 */
module.exports.formatMillisecondsToHHMMSS = function(timeInMilliseconds) {
    var hours,
        minutes,
        seconds = timeInMilliseconds / 1000;
    hours = Math.floor(seconds / 3600);
    minutes = Math.floor(seconds / 60) % 60;
    seconds = Math.floor(seconds) % 60;
    return (hours < 10 ? '0' : '') + hours + ':' + ((minutes < 10 ? '0' : '') + minutes) + ':' + (seconds < 10 ? '0' : '') + seconds;
};

/**
 * Determine if the subject string starts with the needle string. Performs a case insensitive comparison.
 * @param subject
 * @param needle
 * @returns {boolean}
 */
module.exports.startsWith = function(subject, needle) {
    var subjectLowerCase = subject.toLowerCase(),
        needleLowerCase = needle.toLowerCase();
    return subjectLowerCase.indexOf(needleLowerCase) == 0;
};

/**
 * Determine if the subject string ends with the needle string. Performs a case insensitive comparison.
 * @param subject
 * @param needle
 * @returns {boolean}
 */
module.exports.endsWith = function(subject, needle) {
    var subjectLowerCase = subject.toLowerCase(),
        needleLowerCase = needle.toLowerCase(),
        startIndex = subjectLowerCase.length - needleLowerCase.length;
    return subjectLowerCase.indexOf(needleLowerCase, startIndex) == startIndex;
};

/**
 * Determine if a given configuration variable is set. Set would mean it is a property on the object and it is not empty.
 * @param key
 * @returns {boolean}
 */
module.exports.isPropertySet = function(object, key) {
    var isSet = false;
    if (object[key] !== undefined) {
        isSet = object[key].toString().trim().length > 0;
    }
    return isSet;
};

/**
 * Determine if a given configuration variable is set. Set would mean it is a property on the object and it is not empty.
 * @param key
 * @returns {boolean}
 */
module.exports.getIfPropertySet = function(object, key, defaultValue) {
    if (object[key] !== undefined && object[key].toString().trim().length > 0) {
        return object[key];
    } else {
        return defaultValue;
    }
};

