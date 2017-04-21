# Sonos
This app adds support for Sonos devices, e.g. Play/Pause, Previous, Next, Mute/Unmute & Volume control.

# Media (compatible with Homey v1.2.0 and higher)
Sonos now also supports Homey Media! This makes it possible to play playlists from Homey Media to the Sonos. <br/>
Features of this app in combination with Homey Media include:<br/>
Play a Sonos playlist on Sonos<br/>
Play tracks from the Spotify/Soundcloud app to Sonos<br/>
Play mixed source playlists from Homey Media

### Known bugs
Spotify playback is only possible when you are logged into spotify on the Sonos speaker. The app does not check this yet and will fail to play Spotify songs when you are not logged in.

##What's new
####v2.3.0
Fixed bug where Google Play Music tracks could not be played on Sonos speakers
Added condition card to check the current playback state of a speaker.

####v2.2.2
Added polling for playlist changes each hour<br/>
Added check for playlist changes each time you switch speakers to a Sonos speaker.

####v2.2.1
Added Group (Un)Mute flow cards
Fixed (Un)Mute card muting the main group node instead of the speaker in the flow card<br/>
Fixed crash when Sonos response data was corrupt which occured in some instances