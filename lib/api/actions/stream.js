'use strict';

function getArtistMetadata(artists) {
	const artist = (artists || []).find(artist => artist.name && artist.type === 'artist');
	if (artist) {
			return `<upnp:artist role="Performer">${artist.name}</upnp:artist><dc:creator>${artist.name}</dc:creator>`;
	}
	return `<dc:creator>${artists && artists[0] && artists[0].name ? artists[0].name : ''}</dc:creator>`;
}

function getStreamMetadata(track) {
	const albumArt = track.artwork ? track.artwork.medium || track.artwork.large || track.artwork.small : null;
	const duration = track.duration ? `${Math.floor(track.duration / 3600000)
		}:${`0${Math.floor((track.duration % 3600000) / 60000)}`.slice(-2)
		}:${`0${Math.round((track.duration % 60000) / 1000)}`.slice(-2)}` : null;

	console.log('TRACK', track);
	return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:sec="http://www.sec.co.kr/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
        <item id="0" parentID="-1" restricted="1">
        <upnp:class>object.item.audioItem.musicTrack</upnp:class>
        <dc:title>${track.title}</dc:title>
	      ${getArtistMetadata(track.artist)}
        ${track.album ? `<upnp:album>${track.album}</upnp:album>` : '<upnp:album />'}
        ${albumArt ? `<upnp:albumArtUri>${albumArt}</upnp:albumArtUri>` : ''}
        <res ${duration ? `duration="${duration}"` : ''} protocolInfo="http-get:*:audio/mpeg:*"></res>
        </item></DIDL-Lite>`
}

async function stream(player, values) {
	const action = values[0];
	const track = values[1];
	if (!track) {
		return Promise.reject('Expected Track object');
	}
	if (!track.stream_url) {
		return Promise.reject('Expected track.stream_url to be set');
	}

	const uri = track.stream_url;
	const metadata = getStreamMetadata(track);

	if (action === 'queue') {
		return player.coordinator.addURIToQueue(uri, metadata);
	} else if (action === 'now') {
		const nextTrackNo = player.coordinator.state.trackNo + 1;

		if (player.coordinator.avTransportUri.startsWith('x-rincon-queue') === false) {
			await player.coordinator.setAVTransport(`x-rincon-queue:${player.coordinator.uuid}#0`);
		}

		return player.coordinator.addURIToQueue(uri, metadata, true, nextTrackNo)
			.then((addToQueueStatus) => player.coordinator.trackSeek(addToQueueStatus.firsttracknumberenqueued))

	} else if (action === 'next') {
		const nextTrackNo = player.coordinator.state.trackNo + 1;
		return player.coordinator.addURIToQueue(uri, metadata, true, nextTrackNo);
	}

	return promise.then(() => player.coordinator.setAVTransport(uri, metadata));
}

module.exports = function (api) {
	api.registerAction('stream', stream);
};

// Working SOAP Body
// <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:AddURIToQueue xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><EnqueuedURI>https://r1---sn-5hnekn7z.c.doc-0-0-sj.sj.googleusercontent.com/videoplayback?id=3c4bcadc86b50943&amp;itag=25&amp;source=skyjam&amp;begin=0&amp;ei=GABzWrC6EcGIwwKYjoaoDw&amp;o=06776416745300621078&amp;cmbypass=yes&amp;ratebypass=yes&amp;cpn=WMFUEVByJrRnokXd_DD3eQ&amp;ip=217.114.108.248&amp;ipbits=0&amp;expire=1517486194&amp;sparams=cmbypass,ei,expire,id,initcwndbps,ip,ipbits,itag,mm,mn,ms,mv,o,pl,ratebypass,source&amp;signature=1206A33841501CFE94D14CB265521796BB8AE464.2C11139EA7DC36D2A7E74A9C82688005B0D8FFD0&amp;key=cms1&amp;initcwndbps=18380&amp;mm=31&amp;mn=sn-5hnekn7z&amp;ms=au&amp;mt=1517486020&amp;mv=m&amp;pl=20</EnqueuedURI><EnqueuedURIMetaData>&lt;DIDL-Lite xmlns=&quot;urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/&quot; xmlns:dc=&quot;http://purl.org/dc/elements/1.1/&quot; xmlns:sec=&quot;http://www.sec.co.kr/&quot; xmlns:upnp=&quot;urn:schemas-upnp-org:metadata-1-0/upnp/&quot;&gt;
// &lt;item id=&quot;0&quot; parentID=&quot;-1&quot; restricted=&quot;1&quot;&gt;
// &lt;upnp:class&gt;object.item.audioItem.musicTrack&lt;/upnp:class&gt;
// &lt;dc:title&gt;The Final Countdown&lt;/dc:title&gt;
// &lt;upnp:artist role=&quot;Performer&quot;&gt;Europe&lt;/upnp:artist&gt;&lt;dc:creator&gt;Europe&lt;/dc:creator&gt;
// &lt;upnp:album&gt;The Final Countdown (Expanded Edition)&lt;/upnp:album&gt;
// &lt;upnp:albumArtUri&gt;http://lh3.googleusercontent.com/HmVZInOOtYKzK1F6sEz8KUWcZoyuxxZCtQiIVchoq_hm5HxFY2oXr1GUnU8DpDkC9CjjFz5CrQ&lt;/upnp:albumArtUri&gt;
// &lt;res duration=&quot;0:05:10&quot; protocolInfo=&quot;http-get:*:audio/mpeg:*&quot;&gt;&lt;/res&gt;
// &lt;/item&gt;&lt;/DIDL-Lite&gt;</EnqueuedURIMetaData><DesiredFirstTrackNumberEnqueued>2</DesiredFirstTrackNumberEnqueued><EnqueueAsNext>1</EnqueueAsNext></u:AddURIToQueue></s:Body></s:Envelope>
