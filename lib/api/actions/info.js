'use strict';

const request = require('request');
const xml2js = require('xml2js');
const parser = new xml2js.Parser();

function info(player) {
	return new Promise((resolve, reject) => {
		request(`${player.baseUrl}/xml/device_description.xml`, (error, response, body) => {
			if (error) return reject(error);

			parser.parseString(body, function (err, result) {
				if (err) return reject(err);
				resolve((result.root.device || [])[0]);
			});
		});
	});
}

module.exports = function (api) {
	api.registerAction('info', info);
};
