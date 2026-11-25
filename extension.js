import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const EFFECT_NAME = 'grayscale-extension';
const ICON = 'display-brightness-symbolic';

// id -> [menu label, shader mode]
const FILTERS = {
    grayscale: ['Grayscale', 0],
    paper: ['Paper', 1],
    invert: ['Inverted', 2],
    red: ['Night Red', 3],
};

const DECLARATIONS = `
uniform float mode;
float rand(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
`;

// Runs after the default texture lookup; cogl_color_out is premultiplied.
const CODE = `
float a = cogl_color_out.a;
vec3 c = a > 0.0 ? cogl_color_out.rgb / a : vec3(0.0);
float l = dot(c, vec3(0.2126, 0.7152, 0.0722));

if (mode < 0.5) {
    c = vec3(l);
} else if (mode < 1.5) {
    // Paper: mostly desaturated, warm off-white paper and deep warm ink
    // instead of pure white/black, plus a faint static grain. The curve
    // pushes midtones down so text and images stay inky, not washed out.
    c = mix(c, vec3(l), 0.85);
    c = pow(c, vec3(1.3));
    c = mix(vec3(0.06, 0.055, 0.05), vec3(0.95, 0.92, 0.85), c);
    c += (rand(floor(gl_FragCoord.xy)) - 0.5) * 0.04;
} else if (mode < 2.5) {
    // Invert brightness but keep hue, so colors stay recognizable.
    c = clamp(c + vec3(1.0 - 2.0 * l), 0.0, 1.0);
} else {
    c = vec3(l, l * 0.08, 0.0);
}

cogl_color_out.rgb = clamp(c, 0.0, 1.0) * a;
`;

const FilterEffect = GObject.registerClass(
class FilterEffect extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE, false);
    }

    setMode(mode) {
        this.set_uniform_float(this.get_uniform_location('mode'), 1, [mode]);
        this.queue_repaint();
    }
});

const FilterToggle = GObject.registerClass(
class FilterToggle extends QuickMenuToggle {
    constructor(settings) {
        super({title: 'Screen Filter', iconName: ICON, toggleMode: true});
        this._settings = settings;
        settings.bind('enabled', this, 'checked', Gio.SettingsBindFlags.DEFAULT);

        this.menu.setHeader(ICON, 'Screen Filter');
        this._items = {};
        for (const [id, [label]] of Object.entries(FILTERS)) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                settings.set_string('filter', id);
                settings.set_boolean('enabled', true);
            });
            this.menu.addMenuItem(item);
            this._items[id] = item;
        }

        settings.connectObject('changed::filter', () => this._sync(), this);
        this._sync();
    }

    _sync() {
        const current = this._settings.get_string('filter');
        for (const [id, item] of Object.entries(this._items))
            item.setOrnament(id === current ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        this.subtitle = FILTERS[current][0];
    }
});

const FilterIndicator = GObject.registerClass(
class FilterIndicator extends SystemIndicator {
    constructor(settings) {
        super();
        this.quickSettingsItems.push(new FilterToggle(settings));
    }
});

export default class GrayscaleExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._indicator = new FilterIndicator(this._settings);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        Main.wm.addKeybinding(
            'toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._settings.set_boolean('enabled', !this._settings.get_boolean('enabled')));

        this._settings.connectObject(
            'changed::enabled', () => this._sync(),
            'changed::filter', () => this._sync(),
            this);
        this._sync();
    }

    disable() {
        Main.wm.removeKeybinding('toggle-shortcut');
        this._settings.disconnectObject(this);
        this._setEffect(null);

        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _sync() {
        const on = this._settings.get_boolean('enabled');
        this._setEffect(on ? FILTERS[this._settings.get_string('filter')][1] : null);
    }

    _setEffect(mode) {
        if (mode === null) {
            if (!this._effect)
                return;
            Main.uiGroup.remove_effect(this._effect);
            this._effect = null;
            global.compositor.enable_unredirect();
            return;
        }

        if (!this._effect) {
            this._effect = new FilterEffect();
            Main.uiGroup.add_effect_with_name(EFFECT_NAME, this._effect);
            // Fullscreen apps normally bypass the compositor (unredirect / direct
            // scanout), which skips our effect. Force them through it while on.
            global.compositor.disable_unredirect();
        }
        this._effect.setMode(mode);
    }
}
