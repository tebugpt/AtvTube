import { configWrite, configRead } from './config.js';
import modernUI, { optionShow } from './ui/settings.js';
import { showToast, buttonItem } from './ui/ytUI.js';
import { t } from 'i18next';
import { requestNextAndNavigateChannel } from './utils/innerTubeCalls.js';
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
                    cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items.splice(2, 0,
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