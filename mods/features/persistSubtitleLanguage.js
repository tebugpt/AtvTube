import { configRead, configWrite, configChangeEmitter } from '../config.js';
import resolveCommand from '../resolveCommand.js';
import { getUserCountryCode, getCountryLanguage } from './moreSubtitles.js';
import languageNames from '../translations/language-names.js';

const SELECTORS = {
    PLAYER: '.html5-video-player',
};

const CONFIG_KEYS = {
    ENABLED: 'enablePersistSubtitleLanguage',
    CODE: 'preferredSubtitleLanguageCode',
    NAME: 'preferredSubtitleLanguageName',
};

const DEFAULT_INIT_KEY = 'subtitleLanguageDefaultInitialized';
const DEFAULT_INIT_MAX_ATTEMPTS = 40;
const DEFAULT_INIT_POLL_INTERVAL_MS = 500;

const CAPTIONS_SETTLE_DELAY_MS = 1000;

const AUTO_APPLY_DELAY_MS = 3000;

let isInternalApply = false;

function getCurrentPlayer() {
    try {
        return document.querySelector(SELECTORS.PLAYER);
    } catch (e) {
        return null;
    }
}

function getPlayerVideoId(player) {
    if (!player) return null;

    try {
        return player.getVideoData?.()?.video_id || null;
    } catch (e) {
        return null;
    }
}

function extractTranslationCommand(cmd) {
    if (!cmd) return null;

    if (cmd.selectSubtitlesTrackCommand?.translationLanguage) {
        return cmd.selectSubtitlesTrackCommand.translationLanguage;
    }

    if (Array.isArray(cmd.commandExecutorCommand?.commands)) {
        for (const subCmd of cmd.commandExecutorCommand.commands) {
            const result = extractTranslationCommand(subCmd);

            if (result) return result;
        }
    }

    return null;
}

function hasSelectSubtitlesTrackCommand(cmd) {
    if (!cmd) return false;

    if (cmd.selectSubtitlesTrackCommand) {
        return true;
    }

    if (Array.isArray(cmd.commandExecutorCommand?.commands)) {
        return cmd.commandExecutorCommand.commands.some(
            hasSelectSubtitlesTrackCommand
        );
    }

    return false;
}

function isNonTranslationSubtitleCommand(cmd) {
    if (!cmd) return false;

    if (
        cmd.selectSubtitlesTrackCommand &&
        !cmd.selectSubtitlesTrackCommand.translationLanguage
    ) {
        return true;
    }

    if (Array.isArray(cmd.commandExecutorCommand?.commands)) {
        return cmd.commandExecutorCommand.commands.some(
            isNonTranslationSubtitleCommand
        );
    }

    return false;
}

function applyPreferredLanguage() {
    if (!configRead(CONFIG_KEYS.ENABLED)) {
        return;
    }

    const languageCode = configRead(CONFIG_KEYS.CODE);
    const languageName = configRead(CONFIG_KEYS.NAME);

    if (!languageCode) {
        return;
    }

    isInternalApply = true;

    try {
        resolveCommand({
            selectSubtitlesTrackCommand: {
                translationLanguage: {
                    languageCode,
                    languageName: languageName || languageCode,
                },
            },
        });
    } catch (e) {
    }

    Promise.resolve().then(() => {
        isInternalApply = false;
    });
}

function guessLanguageFromNavigator() {
    try {
        const raw = navigator.language || 'en';
        const code = raw.split('-')[0].toLowerCase();
        const name =
            languageNames.language.standard.long[code] || code;

        return { code, name };
    } catch (e) {
        return null;
    }
}

function resolveDeviceDefaultLanguage() {
    try {
        const countryCode = getUserCountryCode();

        if (countryCode) {
            const lang = getCountryLanguage(countryCode);

            if (lang) {
                return lang;
            }
        }
    } catch (e) {
    }

    return guessLanguageFromNavigator();
}

function initializeDefaultSubtitleLanguage(attempt = 0) {
    if (configRead(DEFAULT_INIT_KEY)) {
        return;
    }

    const lang = resolveDeviceDefaultLanguage();

    if (!lang && attempt < DEFAULT_INIT_MAX_ATTEMPTS) {
        setTimeout(
            () => initializeDefaultSubtitleLanguage(attempt + 1),
            DEFAULT_INIT_POLL_INTERVAL_MS
        );

        return;
    }

    if (lang) {
        configWrite(CONFIG_KEYS.ENABLED, true);
        configWrite(CONFIG_KEYS.CODE, lang.code);
        configWrite(CONFIG_KEYS.NAME, lang.name);
    }

    configWrite(DEFAULT_INIT_KEY, true);
}

class SubtitlePersistenceHandler {
    #player = null;
    #lastVideoId = null;
    #scheduledVideoId = null;
    #timers = [];
    #isPatched = false;

    #overriddenVideoId = null;

    #captionsWereOn = false;

    #captionsBaselineReady = false;
    #captionsBaselineTimerId = null;

    constructor() {
        this.init();
    }

    init() {
        this.#startDOMCheck();
        this.#setupConfigListener();
        this.#patchResolveCommand();
    }

    #getVideoId() {
        return getPlayerVideoId(this.#player);
    }

    #isPlayerPlaying() {
        if (!this.#player) {
            return false;
        }

        try {
            const stateObject =
                this.#player.getPlayerStateObject?.();

            if (
                stateObject &&
                typeof stateObject.isPlaying === 'boolean'
            ) {
                return stateObject.isPlaying;
            }

            return this.#player.getPlayerState?.() === 1;
        } catch (e) {
            return false;
        }
    }

    #areCaptionsCurrentlyOn() {
        try {
            const track = this.#player?.getOption?.(
                'captions',
                'track'
            );

            return !!(track && track.languageCode);
        } catch (e) {
            return false;
        }
    }

    #isShowingPreferredTranslation() {
        try {
            const track = this.#player?.getOption?.(
                'captions',
                'track'
            );

            const code = configRead(CONFIG_KEYS.CODE);

            if (!track || !code) {
                return false;
            }

            return track.translationLanguageCode === code;
        } catch (e) {
            return false;
        }
    }

    #applyAndVerifyPreferredLanguage(videoId, attempt = 0) {
        applyPreferredLanguage();

        setTimeout(() => {
            if (this.#getVideoId() !== videoId) {
                return;
            }

            this.#captionsWereOn = this.#areCaptionsCurrentlyOn();

            if (
                !this.#isShowingPreferredTranslation() &&
                attempt < 1
            ) {
                this.#applyAndVerifyPreferredLanguage(
                    videoId,
                    attempt + 1
                );
            }
        }, CAPTIONS_SETTLE_DELAY_MS);
    }

    #correctOnClosedToOpenTransition(videoId, wasOn, attempt = 0) {
        if (this.#getVideoId() !== videoId) {

            return;
        }

        const isOnNow = this.#areCaptionsCurrentlyOn();

        if (isOnNow) {
            this.#captionsWereOn = true;

            if (!wasOn) {

                setTimeout(() => {
                    if (this.#getVideoId() !== videoId) {
                        return;
                    }

                    this.#applyAndVerifyPreferredLanguage(videoId);
                }, CAPTIONS_SETTLE_DELAY_MS);
            }

            return;
        }

        if (attempt < 2) {
            setTimeout(() => {
                this.#correctOnClosedToOpenTransition(
                    videoId,
                    wasOn,
                    attempt + 1
                );
            }, CAPTIONS_SETTLE_DELAY_MS);

            return;
        }

        this.#captionsWereOn = false;
    }

    #clearTimers() {
        for (const timerId of this.#timers) {
            clearTimeout(timerId);
        }

        this.#timers = [];
    }

    #scheduleApply(videoId) {
        if (!videoId) {
            return;
        }

        if (!configRead(CONFIG_KEYS.CODE)) {
            return;
        }

        if (videoId === this.#overriddenVideoId) {
            return;
        }

        if (
            videoId === this.#scheduledVideoId &&
            this.#timers.length > 0
        ) {
            return;
        }

        this.#clearTimers();

        this.#scheduledVideoId = videoId;

        const timerId = setTimeout(() => {
            if (!configRead(CONFIG_KEYS.ENABLED)) {
                return;
            }

            if (this.#getVideoId() !== videoId) {
                return;
            }

            this.#applyAndVerifyPreferredLanguage(videoId);
        }, AUTO_APPLY_DELAY_MS);

        this.#timers.push(timerId);
    }

    #updateVideoContext(videoId) {
        if (!videoId) {
            return;
        }

        if (videoId === this.#lastVideoId) {
            return;
        }

        this.#lastVideoId = videoId;
        this.#scheduledVideoId = null;
        this.#captionsWereOn = false;
        // No baseline probe: always let the scheduled apply run.
        // (Ready immediately so the CC off->on correction hook still works.)
        this.#captionsBaselineReady = true;

        this.#clearTimers();
    }

    #handleStateChange = () => {
        const videoId = this.#getVideoId();

        if (!configRead(CONFIG_KEYS.ENABLED)) {
            return;
        }

        if (!videoId) {
            return;
        }

        this.#updateVideoContext(videoId);

        if (this.#isPlayerPlaying()) {
            this.#scheduleApply(videoId);
        }
    };

    #handlePlaybackStart = () => {
        const videoId = this.#getVideoId();

        if (!configRead(CONFIG_KEYS.ENABLED)) {
            return;
        }

        if (!videoId) {
            return;
        }

        this.#updateVideoContext(videoId);
        this.#scheduleApply(videoId);
    };

    #setupPlayer(player) {
        if (this.#player) {
            try {
                this.#player.removeEventListener(
                    'onStateChange',
                    this.#handleStateChange
                );

                this.#player.removeEventListener(
                    'onPlaybackStartExternal',
                    this.#handlePlaybackStart
                );
            } catch (e) {
            }
        }

        this.#player = player;

        try {
            this.#player.addEventListener(
                'onStateChange',
                this.#handleStateChange
            );

            this.#player.addEventListener(
                'onPlaybackStartExternal',
                this.#handlePlaybackStart
            );
        } catch (e) {
        }

        this.#handleStateChange();
    }

    #startDOMCheck() {
        setInterval(() => {
            const playerElement = getCurrentPlayer();

            if (
                playerElement &&
                this.#player !== playerElement
            ) {
                this.#setupPlayer(playerElement);
            }
        }, 1500);
    }

    #setupConfigListener() {
        configChangeEmitter.addEventListener(
            'configChange',
            (ev) => {
                const key = ev.detail?.key;

                if (
                    key !== CONFIG_KEYS.ENABLED &&
                    key !== CONFIG_KEYS.CODE &&
                    key !== CONFIG_KEYS.NAME
                ) {
                    return;
                }

                this.#scheduledVideoId = null;
                this.#overriddenVideoId = null;
                this.#captionsWereOn = this.#areCaptionsCurrentlyOn();
                this.#captionsBaselineReady = true;
                this.#clearTimers();

                if (
                    configRead(CONFIG_KEYS.ENABLED) &&
                    configRead(CONFIG_KEYS.CODE)
                ) {
                    const videoId = this.#getVideoId();

                    if (videoId) {
                        this.#scheduleApply(videoId);
                    }
                }
            }
        );
    }

    #patchResolveCommand() {
        const interval = setInterval(() => {
            if (this.#isPatched) {
                clearInterval(interval);
                return;
            }

            if (!window._yttv) {
                return;
            }

            const yttvInstance = Object.values(window._yttv).find(
                (obj) =>
                    obj &&
                    obj.instance &&
                    typeof obj.instance.resolveCommand === 'function'
            );

            if (!yttvInstance) {
                return;
            }

            const instance = yttvInstance.instance;

            if (
                instance.resolveCommand
                    .isPatchedByPersistSubtitleLanguage
            ) {
                this.#isPatched = true;
                clearInterval(interval);
                return;
            }

            const originalResolveCommand =
                instance.resolveCommand;

            const self = this;

            instance.resolveCommand = function(cmd, _) {
                const hasSubtitleCommand =
                    hasSelectSubtitlesTrackCommand(cmd);

                const result = originalResolveCommand.apply(
                    this,
                    arguments
                );

                if (
                    configRead(CONFIG_KEYS.ENABLED) &&
                    hasSubtitleCommand &&
                    !isInternalApply
                ) {
                    const translationLanguage =
                        extractTranslationCommand(cmd);

                    if (translationLanguage) {
                        const {
                            languageCode,
                            languageName,
                        } = translationLanguage;

                        if (languageCode) {
                            configWrite(
                                CONFIG_KEYS.CODE,
                                languageCode
                            );

                            configWrite(
                                CONFIG_KEYS.NAME,
                                languageName || languageCode
                            );
                        }
                    } else if (
                        isNonTranslationSubtitleCommand(cmd)
                    ) {
                        const videoId = self.#getVideoId();

                        if (videoId) {

                            self.#overriddenVideoId = videoId;
                            self.#scheduledVideoId = null;
                            self.#clearTimers();

                            if (self.#captionsBaselineReady) {
                                self.#correctOnClosedToOpenTransition(
                                    videoId,
                                    self.#captionsWereOn
                                );
                            }
                        }
                    }
                }

                return result;
            };

            instance.resolveCommand
                .isPatchedByPersistSubtitleLanguage = true;

            this.#isPatched = true;

            clearInterval(interval);
        }, 500);
    }
}

try {
    initializeDefaultSubtitleLanguage();
} catch (e) {
    console.error(
        '[Subtitle Persistence] Default language init failed:',
        e
    );
}

try {
    window.subtitlePersistenceHandler =
        new SubtitlePersistenceHandler();
} catch (e) {
    console.error(
        '[Subtitle Persistence] Startup failed:',
        e
    );
}
