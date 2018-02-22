'use strict';

function getSonosMetadata(trackUri, queueUri, track) {
	const artist = ((track.artist || []).find(entry => entry.type === 'artist') || {}).name || '';
	const metaData = [track.title, artist, track.album, track.duration / 1000];

	return `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"
        xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
        <item id="${queueUri}/${encodeURIComponent(trackUri)}:A${encodeURIComponent(metaData.join(','))}" parentId="${queueUri}" restricted="true">
        <upnp:class>object.item.audioItem.musicTrack</upnp:class>
        <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">RINCON_AssociatedZPUDN</desc></item></DIDL-Lite>`;
}

async function setSonosUri(player, values) {
	const action = values[0];
	const track = values[1];

	const queueUriIndex = track.stream_url.indexOf('!');
	const queueUri = track.stream_url.slice(0, queueUriIndex);
	const trackUri = track.stream_url.slice(queueUriIndex + 1);

	const sonosUri = decodeURIComponent(trackUri);

	const metadata = getSonosMetadata(trackUri, queueUri, track);

	if (action === 'queue') {
		return player.coordinator.addURIToQueue(sonosUri, metadata);
	} else if (action === 'now') {
		const nextTrackNo = player.coordinator.state.trackNo + 1;
		if (player.coordinator.avTransportUri.startsWith('x-rincon-queue') === false) {
			await player.coordinator.setAVTransport(`x-rincon-queue:${player.coordinator.uuid}#0`);
		}

		return player.coordinator.addURIToQueue(sonosUri, metadata, true, nextTrackNo)
			.then((addToQueueStatus) => player.coordinator.trackSeek(addToQueueStatus.firsttracknumberenqueued));

	} else if (action === 'next') {
		const nextTrackNo = player.coordinator.state.trackNo + 1;
		return player.coordinator.addURIToQueue(sonosUri, metadata, true, nextTrackNo);
	}
}

module.exports = (api) => {
	api.registerAction('setsonosuri', setSonosUri);
};


// WORKING BUT NO METADATA 2
// <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:AddURIToQueue xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
// <InstanceID>0</InstanceID>
// <EnqueuedURI>x-sonos-spotify:spotify:track:7m9euwqyxRdTgPACE0E8T1?sid=9&amp;flags=8224&amp;sn=17</EnqueuedURI>
//
// <EnqueuedURIMetaData>
// <DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
// 	<item id="SQ:4/x-sonos-spotify:spotify%3atrack%3a7m9euwqyxRdTgPACE0E8T1?sid=9&flags=8224&sn=17:ATorn Apart,Fynn,Torn Apart,207" parentId="SQ:4" restricted="true">
// <upnp:class>object.item.audioItem.musicTrack</upnp:class>
// <res duration="0:03:27"></res>
// 	<dc:title>Torn Apart</dc:title>
// <upnp:album>Torn Apart</upnp:album>
// <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">RINCON_AssociatedZPUDN</desc>
// </item>
// </DIDL-Lite>
//
// </EnqueuedURIMetaData>
// <DesiredFirstTrackNumberEnqueued>2</DesiredFirstTrackNumberEnqueued>
// <EnqueueAsNext>1</EnqueueAsNext>
// </u:AddURIToQueue>
// </s:Body></s:Envelope>

// WORKING FROM OLD APP
// <u:AddURIToQueue xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
// <InstanceID>0</InstanceID>
// <EnqueuedURI>x-sonos-spotify:spotify%3atrack%3a7m9euwqyxRdTgPACE0E8T1?sid=9&amp;flags=8224&amp;sn=17</EnqueuedURI>
// <EnqueuedURIMetaData>
//
// <DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
// <item id="SQ:4/x-sonos-spotify%3Aspotify%253atrack%253a7m9euwqyxRdTgPACE0E8T1%3Fsid%3D9%26flags%3D8224%26sn%3D17:ATorn%20Apart,Fynn,Torn%20Apart,207" parentId="SQ:4" restricted="true">
// <res duration="0:03:27"></res>
// <dc:title>Torn Apart</dc:title>
// <upnp:album>Torn Apart</upnp:album>
// <upnp:class>object.item.audioItem.musicTrack</upnp:class>
// <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">RINCON_AssociatedZPUDN</desc>
// </item>
// </DIDL-Lite>
//
// </EnqueuedURIMetaData>
// <DesiredFirstTrackNumberEnqueued>0</DesiredFirstTrackNumberEnqueued>
// <EnqueueAsNext>1</EnqueueAsNext>
// </u:AddURIToQueue>


// WIP
// <EnqueuedURIMetaData>
// <item id="SQ:4/x-sonos-spotify:spotify%3atrack%3a7m9euwqyxRdTgPACE0E8T1?sid=9&flags=8224&sn=17:ATorn Apart,Fynn,Torn Apart,207" parentId="SQ:4" restricted="true">
// <item id="SQ:4/x-sonos-spotify%3Aspotify%253atrack%253a7m9euwqyxRdTgPACE0E8T1%3Fsid%3D9%26flags%3D8224%26sn%3D17:ATorn%20Apart,Fynn,Torn%20Apart,207" parentId="SQ:4" restricted="true">








// WORKING BUT NO METADATA
// <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
// <s:Body>
// <u:AddURIToQueue xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
// <InstanceID>0</InstanceID>
// <EnqueuedURI>x-sonos-spotify:spotify:track:0pZdF8MX0CVmUQPsyphj8r?sid=9&amp;flags=8224&amp;sn=17</EnqueuedURI>
//
// <EnqueuedURIMetaData>
//
// <DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
// 	<item id="SQ:2/x-sonos-spotify:spotify%3atrack%3a0pZdF8MX0CVmUQPsyphj8r?sid=9&flags=8224&sn=17" parentId="SQ:2" restricted="true">
//   <upnp:class>object.item.audioItem.musicTrack</upnp:class>
// <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">RINCON_AssociatedZPUDN</desc>
// </item>
// </DIDL-Lite>
//
//
// </EnqueuedURIMetaData>
//
// <DesiredFirstTrackNumberEnqueued>2</DesiredFirstTrackNumberEnqueued>
// <EnqueueAsNext>1</EnqueueAsNext>
// </u:AddURIToQueue>
// </s:Body>
// </s:Envelope>


// Working SOAP Body
// <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
// <s:Body>
// <u:AddURIToQueue xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
// <InstanceID>0</InstanceID>
// <EnqueuedURI>x-sonos-spotify:spotify%3Atrack%3A3AchVMlCSZhA3hMKkG7Kpe?sid=9&amp;flags=32&amp;sn=1</EnqueuedURI>
//
// <EnqueuedURIMetaData>
//
// <DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
// 	<item id="00030020spotify%3Atrack%3A3AchVMlCSZhA3hMKkG7Kpe" restricted="true">
// <upnp:class>object.item.audioItem.musicTrack</upnp:class>
// <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON2311_X_#Svc2311-0-Token</desc>
// </item>
// </DIDL-Lite>
//
// </EnqueuedURIMetaData>
// <DesiredFirstTrackNumberEnqueued>1</DesiredFirstTrackNumberEnqueued>
// <EnqueueAsNext>1</EnqueueAsNext>
// </u:AddURIToQueue>
// </s:Body>
// </s:Envelope>