const deviceProfiles = [
    {
        architecture: 'Linux arm64-v8a',
        os: 'Android 10',
        rasterizer: 'gles',
        manufacturer: 'Sony',
        deviceType: 'ATV',
        chipsetModel: 'sdm845',
        modelYear: 13140765,
        firmwareVersion: '52.1.C.0.268',
        brand: 'KDDI',
        model: 'SOV38'
    },
    {
        architecture: 'Linux armeabi-v7a',
        os: 'Android 14',
        rasterizer: 'gles',
        manufacturer: 'Google',
        deviceType: 'ATV',
        chipsetModel: 'sabrina',
        modelYear: 2020,
        firmwareVersion: 'UTTC.250917.004',
        brand: 'google',
        model: 'Chromecast'
    },
    {
        architecture: 'Linux armeabi-v7a',
        os: 'Android 12',
        rasterizer: 'gles',
        manufacturer: 'TCL',
        deviceType: 'ATV',
        chipsetModel: 'merak',
        modelYear: 2023,
        firmwareVersion: 'STT2.221228.001',
        brand: 'TCL',
        model: 'Smart TV Pro'
    },
    {
        architecture: 'Linux armeabi-v7a',
        os: 'Android 7.1.2',
        rasterizer: 'gles',
        manufacturer: 'Amazon',
        deviceType: 'ATV',
        chipsetModel: 'mt8695',
        modelYear: 0,
        firmwareVersion: 'NS6294',
        brand: 'Amazon',
        model: 'AFTMM'
    }
]

const cobaltVersion = '25.lts.30.1034958-gold';
const v8Version = 'v8/8.8.278.17-jit';
const starboardVersion = '15';
const auxField = 'com.google.android.youtube.tv/5.30.301';

function generateUserAgent(profile) {
    return `Mozilla/5.0 (${profile.architecture}; ${profile.os}) Cobalt/${cobaltVersion} (unlike Gecko) ${v8Version} ${profile.rasterizer} Starboard/${starboardVersion}, ${profile.manufacturer}_${profile.deviceType}_${profile.chipsetModel}_${profile.modelYear}/${profile.firmwareVersion} (${profile.brand}, ${profile.model}) ${auxField}`;
}

// NOTE ON THE FIX:
// Previously this block re-ran window.h5vcc.tizentube.SetUserAgent(...) + location.reload()
// on every single document load whenever a UA was already stored in localStorage. Since
// SetUserAgent only affects the current process's NetworkModule (it does NOT persist across
// a location.reload() re-check, only across a real process restart via the native
// persistent_settings read in NetworkModule::Initialize), reapplying + reloading on every
// load produced an infinite reload loop that looked identical to being "stuck" on the
// device-authorization screen.
//
// sessionStorage survives location.reload() within the same process/session but is cleared
// on a real app restart, so it's the correct primitive for "have I already applied + reloaded
// once in this running process" — as opposed to localStorage, which only tells you "has a UA
// ever been generated" and stays true forever once set.
if (document.querySelector('.content-container') && window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.SetUserAgent) {
    let ua = localStorage.getItem('userAgent');

    if (!ua) {
        const randomProfile = deviceProfiles[Math.floor(Math.random() * deviceProfiles.length)];
        ua = generateUserAgent(randomProfile);
        localStorage.setItem('userAgent', ua);
    }

    if (!sessionStorage.getItem('uaApplied')) {
        sessionStorage.setItem('uaApplied', '1');
        window.h5vcc.tizentube.SetUserAgent(ua);
        location.reload();
    }
    // else: UA has already been applied and the page already reloaded once during this
    // process's lifetime — do nothing further, let the page continue loading normally.
}
