'use strict';

const logger = require('homey-log').Log;

module.exports.init = () => {
	console.log(`${Homey.manifest.id} running...`);
};
