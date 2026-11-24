import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const EFFECT_NAME = 'grayscale-extension';

const GrayscaleToggle = GObject.registerClass(
class GrayscaleToggle extends QuickToggle {
    constructor(settings) {
        super({
            title: 'Grayscale',
            iconName: 'display-brightness-symbolic',
            toggleMode: true,
        });
        settings.bind('enabled', this, 'checked', Gio.SettingsBindFlags.DEFAULT);
    }
});

const GrayscaleIndicator = GObject.registerClass(
class GrayscaleIndicator extends SystemIndicator {
    constructor(settings) {
        super();
        this.quickSettingsItems.push(new GrayscaleToggle(settings));
    }
});

export default class GrayscaleExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._indicator = new GrayscaleIndicator(this._settings);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        Main.wm.addKeybinding(
            'toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._settings.set_boolean('enabled', !this._settings.get_boolean('enabled')));

        this._changedId = this._settings.connect('changed::enabled', () => this._sync());
        this._sync();
    }

    disable() {
        Main.wm.removeKeybinding('toggle-shortcut');
        this._settings.disconnect(this._changedId);
        this._setActive(false);

        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _sync() {
        this._setActive(this._settings.get_boolean('enabled'));
    }

    _setActive(on) {
        if (on === !!this._active)
            return;
        this._active = on;

        if (on) {
            Main.uiGroup.add_effect_with_name(EFFECT_NAME, new Clutter.DesaturateEffect({factor: 1.0}));
            // Fullscreen apps normally bypass the compositor (unredirect / direct
            // scanout), which skips our effect. Force them through it while on.
            global.compositor.disable_unredirect();
        } else {
            Main.uiGroup.remove_effect_by_name(EFFECT_NAME);
            global.compositor.enable_unredirect();
        }
    }
}
