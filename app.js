'use strict';

// const logger = require('homey-log').Log;

const url = require('url');
const http = require('http');
const https = require('https');
const httpProxy = require('http-proxy');

module.exports.init = () => {
	console.log(`${Homey.manifest.id} running...`);
};

const proxy = httpProxy.createProxyServer({
	ignorePath: true,
	protocolRewrite: true,
	autoRewrite: true,
	hostRewrite: true,
});

proxy.on('error', function (err, req, res) {
	res.writeHead(500, {
		'Content-Type': 'text/plain',
	});

	res.end('Something went wrong. And we are reporting a custom error message.');
});

function notFound(res) {
	res.writeHead(404, 'text/plain');
	res.end('404: File not found');
}

const server = http.createServer((req, res) => {
	const parsedUrl = url.parse(req.url, true);


	if (!parsedUrl.query || !parsedUrl.query.url) return notFound(res);
	const targetUrl = url.parse(decodeURIComponent(parsedUrl.query.url));

	console.log(require('util').inspect(targetUrl, { depth: 5 }));

	proxy.web(
		req,
		res,
		{
			target: targetUrl.href,
			agent: targetUrl.protocol === 'https:' ? https.globalAgent : http.globalAgent,
			headers: { host: targetUrl.hostname },
		}
	);
});

server.listen(5050);
