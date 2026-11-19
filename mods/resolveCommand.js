import { configWrite, configRead } from './config.js';
import { enablePip } from './features/pictureInPicture.js';
import modernUI, { optionShow } from './ui/settings.js';
import { speedSettings } from './ui/speedUI.js';
import { showToast, buttonItem, showModal, QrCodeRenderer, overlayPanelItemListRenderer, overlayMessageRenderer } from './ui/ytUI.js';
import { t } from 'i18next';
import { requestNextAndNavigateChannel } from './utils/innerTubeCalls.js';
import qrcode from 'qrcode-npm';
import showGuideSettings from './ui/sidebarModification.js';

export default function resolveCommand(cmd, _) {
    // resolveCommand function is pretty OP, it can do from opening modals, changing client settings and way more.
    // Because the client might change, we should find it first.

    for (const key in window._yttv) {
        if (window._yttv[key] && window._yttv[key].instance && window._yttv[key].instance.resolveCommand) {
            return window._yttv[key].instance.resolveCommand(cmd, _);
        }
    }
}

export function findFunction(funcName) {
    for (const key in window._yttv) {
        if (window._yttv[key] && window._yttv[key][funcName] && typeof window._yttv[key][funcName] === 'function') {
            return window._yttv[key][funcName];
        }
    }
}

// Patch resolveCommand to be able to change TizenTube settings

export function patchResolveCommand() {
    for (const key in window._yttv) {
        if (window._yttv[key] && window._yttv[key].instance && window._yttv[key].instance.resolveCommand) {

            const ogResolve = window._yttv[key].instance.resolveCommand;
            window._yttv[key].instance.resolveCommand = function (cmd, _) {
                if (cmd.setClientSettingEndpoint) {
                    // Command to change client settings. Use TizenTube configuration to change settings.
                    for (const settings of cmd.setClientSettingEndpoint.settingDatas) {
                        if (!settings.clientSettingEnum.item.includes('_')) {
                            for (const setting of cmd.setClientSettingEndpoint.settingDatas) {
                                const valName = Object.keys(setting).find(key => key.includes('Value'));
                                const value = valName === 'intValue' ? Number(setting[valName]) : setting[valName];
                                if (valName === 'arrayValue') {
                                    const arr = configRead(setting.clientSettingEnum.item);
                                    if (arr.includes(value)) {
                                        arr.splice(arr.indexOf(value), 1);
                                    } else {
                                        arr.push(value);
                                    }
                                    configWrite(setting.clientSettingEnum.item, arr);
                                } else configWrite(setting.clientSettingEnum.item, value);
                            }
                        } else if (settings.clientSettingEnum.item === 'I18N_LANGUAGE') {
                            const lang = settings.stringValue;
                            const date = new Date();
                            date.setFullYear(date.getFullYear() + 10);
                            document.cookie = `PREF=hl=${lang}; expires=${date.toUTCString()};`;
                            resolveCommand({
                                signalAction: {
                                    signal: 'RELOAD_PAGE'
                                }
                            });
                            return true;
                        }
                    }
                } else if (cmd.customAction) {
                    customAction(cmd.customAction.action, cmd.customAction.parameters);
                    return true;
                } else if (cmd?.signalAction?.customAction) {
                    customAction(cmd.signalAction.customAction.action, cmd.signalAction.customAction.parameters);
                    return true;
                } else if (cmd?.showEngagementPanelEndpoint?.customAction) {
                    customAction(cmd.showEngagementPanelEndpoint.customAction.action, cmd.showEngagementPanelEndpoint.customAction.parameters);
                    return true;
                } else if (cmd?.playlistEditEndpoint?.customAction) {
                    customAction(cmd.playlistEditEndpoint.customAction.action, cmd.playlistEditEndpoint.customAction.parameters);
                    return true;
                } else if (cmd?.openPopupAction?.uniqueId === 'playback-settings') {
                    // Patch the playback settings popup to use TizenTube speed settings
                    const items = cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items;
                    for (const item of items) {
                        const iconType = item?.compactLinkRenderer?.icon?.iconType;
                        if (iconType === 'SLOW_MOTION_VIDEO' || iconType === 'SPEEDOMETER') {
                            item.compactLinkRenderer.subtitle && (item.compactLinkRenderer.subtitle.simpleText = t('player.withTizenTube'));
                            item.compactLinkRenderer.serviceEndpoint = {
                                clickTrackingParams: "null",
                                signalAction: {
                                    customAction: {
                                        action: 'TT_SPEED_SETTINGS_SHOW',
                                        parameters: []
                                    }
                                }
                            };
                        }
                    }

                    cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items.splice(2, 0,
                        buttonItem(
                            { title: t('player.miniPlayer') },
                            { icon: 'CLEAR_COOKIES' }, [
                            {
                                customAction: {
                                    action: 'ENTER_MP'
                                }
                            }
                        ])
                    );

                    cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items.splice(3, 0,
                        buttonItem(
                            { title: t('player.share.button') },
                            { icon: 'OPEN_IN_NEW' }, [
                            {
                                customAction: {
                                    action: 'SHARE'
                                }
                            }
                        ])
                    );

                    cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items.splice(3, 0,
                        buttonItem(
                            { title: t('player.screenOff') },
                            { icon: 'EYE_OFF' }, [
                            {
                                customAction: {
                                    action: 'SCREEN_OFF'
                                }
                            }
                        ])
                    );

                    if (window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.HasSystemFeature &&
                        window.h5vcc.tizentube.HasSystemFeature('android.software.picture_in_picture')) {
                        cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items.splice(3, 0,
                            buttonItem(
                                { title: t('player.pictureInPicture') },
                                { icon: 'TV' }, [
                                {
                                    customAction: {
                                        action: 'ENTER_PIP'
                                    }
                                },
                                {
                                    signalAction: {
                                        signal: 'POPUP_BACK'
                                    }
                                }
                            ])
                        );
                    }
                } else if (cmd?.watchEndpoint?.videoId) {
                    window.isPipPlaying = false;
                    const ytlrPlayerContainer = document.querySelector('ytlr-player-container');
                    ytlrPlayerContainer.style.removeProperty('z-index');
                }

                if (cmd.customAction) return window._yttv[key].instance.resolveCommand(cmd, _);

                if (cmd.commandExecutorCommand && cmd.commandExecutorCommand.commands) {
                    for (const command of cmd.commandExecutorCommand.commands) {
                        if (command.customAction) {
                            customAction(command.customAction.action, command.customAction.parameters);
                        } else if (command.signalAction?.customAction) {
                            customAction(command.signalAction.customAction.action, command.signalAction.customAction.parameters);
                        } else if (command.showEngagementPanelEndpoint?.customAction) {
                            customAction(command.showEngagementPanelEndpoint.customAction.action, command.showEngagementPanelEndpoint.customAction.parameters);
                        } else if (command.playlistEditEndpoint?.customAction) {
                            customAction(command.playlistEditEndpoint.customAction.action, command.playlistEditEndpoint.customAction.parameters);
                        } else {
                            window._yttv[key].instance.resolveCommand(command, _);
                        }
                    }
                    return true;
                }

                if (cmd?.requestAccountSelectorCommand
                    && cmd.requestAccountSelectorCommand?.identityActionContext?.eventTrigger === 'ACCOUNT_EVENT_TRIGGER_ON_EXIT') {
                    if (!configRead('enableWhosWatchingMenuOnAppExit')) {
                        ogResolve.call(this, {
                            signalAction: {
                                signal: 'EXIT_APP'
                            }
                        });
                        return false;
                    }
                }

                return ogResolve.call(this, cmd, _);
            }
        }
    }
}

function customAction(action, parameters) {
    switch (action) {
        case 'SETTINGS_UPDATE':
            modernUI(true, parameters);
            break;
        case 'OPTIONS_SHOW':
            optionShow(parameters, parameters.update);
            break;
        case 'SKIP':
            const kE = document.createEvent('Event');
            kE.initEvent('keydown', true, true);
            kE.keyCode = 27;
            kE.which = 27;
            document.dispatchEvent(kE);

            document.querySelector('video').currentTime = parameters.time;
            break;
        case 'TT_SETTINGS_SHOW':
            modernUI();
            break;
        case 'TT_SPEED_SETTINGS_SHOW':
            speedSettings();
            break;
        case 'SET_PLAYER_SPEED':
            const speed = Number(parameters);
            document.querySelector('video').playbackRate = speed;
            break;
        case 'ENTER_MP':
            enablePip();
            break;
        case 'ENTER_PIP':
            window.h5vcc.tizentube.EnterPIP();
            break;
        case 'SHOW_TOAST':
            showToast('YouTube', parameters);
            break;
        case 'ADD_TO_QUEUE':
            window.queuedVideos.videos.push(parameters);
            showToast('YouTube', t('toasts.videoAddedToQueue'));
            break;
        case 'CLEAR_QUEUE':
            window.queuedVideos.videos = [];
            showToast('YouTube', t('toasts.videoQueueCleared'));
            break;
        case 'GO_TO_CHANNEL':
            requestNextAndNavigateChannel(parameters);
            break;
        case 'SHARE': {
            const videoPlayer = document.querySelector('.html5-video-player');
            const videoId = videoPlayer && videoPlayer.getVideoData && videoPlayer.getVideoData().video_id;
            if (!videoId) {
                showToast('TizenTube', 'No video to share');
                break;
            }
            const shareUrl = `https://youtu.be/${videoId}`;
            const qrImage = qrPngDataUrl(qrcode, shareUrl);

            const items = [overlayMessageRenderer(t('player.share.qrCodeScanMessage'))];
            if (qrImage) items.push(QrCodeRenderer(qrImage));
            items.push(overlayMessageRenderer(shareUrl));
            showModal({
                title: t('player.share.title'),
            }, overlayPanelItemListRenderer(items), 'tt-share-modal');
            break;
        }
        case 'SHOW_GUIDE_BUTTONS':
            showGuideSettings('SHOW_GUIDE_BUTTONS', parameters);
            break;
        case 'RELOAD_GUIDE_OPTIONS':
            showGuideSettings(parameters.settingType, true);
            break;
        case 'MOVE_GUIDE_BUTTON':
            showGuideSettings('MOVE_GUIDE_BUTTON', parameters);
            break;
        case 'SHOW_GUIDE_SETTINGS':
            showGuideSettings(parameters);
            break;
        case 'ADD_OR_REMOVE_CHANNEL_TO_SIDEBAR':
            const sortedSidebarContents = configRead('sidebarContentsOrder');

            if (sortedSidebarContents.find(item => item.browseId === parameters.browseId)) {
                sortedSidebarContents.splice(sortedSidebarContents.findIndex(item => item.browseId === parameters.browseId), 1);
            } else {
                sortedSidebarContents.push({
                    browseId: parameters.browseId,
                    title: parameters.title,
                });
            }
            configWrite('sidebarContentsOrder', sortedSidebarContents);
            showToast(t('toasts.sidebarContentsUpdated.title'), t('toasts.sidebarContentsUpdated.subtitle'));
            break;
        case 'SCREEN_OFF':
            for (const child of document.body.children) {
                if (child.tagName.toLowerCase() === 'script' || child.tagName.toLowerCase() === 'svg') continue;
                child.style.setProperty('display', 'none', 'important');
            }
            window.screenTurnedOffAt = Date.now();
            break;
    }
}

/* ---- Share QR: PNG data URL builder (see comment below) ---- */
// Share-QR image builder.
//
// The TV host (Cobalt) cannot use the GIF that qrcode-npm's createImgTag() produces, cannot load
// SVG images, and has no canvas, but it does load PNG `data:` URLs. So the PNG is encoded here by
// hand: 1-bit grayscale, zlib "stored" (uncompressed) blocks. No canvas, no CompressionStream.

const CRC_TABLE = (function () {
    const t = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t.push(c >>> 0);
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
    let a = 1, b = 0;
    for (let i = 0; i < bytes.length; i++) {
        a = (a + bytes[i]) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
}

function pushU32(out, v) {
    out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
}

function pushChunk(out, type, data) {
    const body = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)].concat(data);
    pushU32(out, data.length);
    for (let i = 0; i < body.length; i++) out.push(body[i]);
    pushU32(out, crc32(body));
}

function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 4096) {
        bin += String.fromCharCode.apply(null, bytes.slice(i, i + 4096));
    }
    return btoa(bin);
}

function pngFromQr(qr, cell, quiet) {
    const count = qr.getModuleCount();
    const dim = (count + quiet * 2) * cell;
    const rowBytes = Math.ceil(dim / 8);

    const raw = [];
    for (let py = 0; py < dim; py++) {
        raw.push(0); // filter: none
        const my = Math.floor(py / cell) - quiet;
        const row = [];
        for (let i = 0; i < rowBytes; i++) row.push(0);
        for (let px = 0; px < dim; px++) {
            const mx = Math.floor(px / cell) - quiet;
            const dark = my >= 0 && mx >= 0 && my < count && mx < count && qr.isDark(my, mx);
            if (!dark) row[px >> 3] |= 0x80 >> (px & 7); // 1 = white
        }
        for (let i = 0; i < rowBytes; i++) raw.push(row[i]);
    }

    const z = [0x78, 0x01];
    for (let pos = 0; pos < raw.length; pos += 65535) {
        const len = Math.min(65535, raw.length - pos);
        const last = pos + len >= raw.length ? 1 : 0;
        z.push(last, len & 255, (len >>> 8) & 255, (~len) & 255, ((~len) >>> 8) & 255);
        for (let i = 0; i < len; i++) z.push(raw[pos + i]);
    }
    pushU32(z, adler32(raw));

    const ihdr = [];
    pushU32(ihdr, dim);
    pushU32(ihdr, dim);
    ihdr.push(1, 0, 0, 0, 0); // 1-bit grayscale, deflate, no filter, no interlace

    const out = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    pushChunk(out, 'IHDR', ihdr);
    pushChunk(out, 'IDAT', z);
    pushChunk(out, 'IEND', []);
    return 'data:image/png;base64,' + toBase64(out);
}

// Smallest QR version that fits (error correction M): fewer modules means bigger squares on screen.
// Falls back to the original version 6 / level H if nothing else works.
function makeQr(qrcode, text) {
    for (let type = 2; type <= 10; type++) {
        try {
            const qr = qrcode.qrcode(type, 'M');
            qr.addData(text);
            qr.make();
            return qr;
        } catch (e) {
            // "code length overflow": try the next version
        }
    }
    const qr = qrcode.qrcode(6, 'H');
    qr.addData(text);
    qr.make();
    return qr;
}

// -> PNG data URL, or null if anything goes wrong
function qrPngDataUrl(qrcode, text) {
    try {
        return pngFromQr(makeQr(qrcode, text), 10, 4);
    } catch (e) {
        console.error('TizenTube: share QR generation failed:', e);
        return null;
    }
}
