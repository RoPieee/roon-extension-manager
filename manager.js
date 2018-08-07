// Copyright 2017, 2018 The Appgineer
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

"use strict";

var RoonApi               = require("node-roon-api"),
    RoonApiSettings       = require('node-roon-api-settings'),
    RoonApiStatus         = require('node-roon-api-status'),
    ApiTimeInput          = require('node-api-time-input'),
    ApiExtensionInstaller = require('node-api-extension-installer');

const ACTION_NO_CHANGE = 0;

var core;
var pending_actions = {};
var category_list = [];
var extension_list = [];
var action_list = [];
var timeout_id = null;
var watchdog_timer_id = null;
var last_message;
var last_is_error;

var roon = new RoonApi({
    extension_id:        'com.theappgineer.extension-manager',
    display_name:        "Roon Extension Manager",
    display_version:     "0.0.0",
    publisher:           'The Appgineer',
    email:               'theappgineer@gmail.com',
    website:             'https://community.roonlabs.com/t/roon-extension-manager/26632',

    core_paired: function(core_) {
        core = core_;
        console.log("Core paired.");

        setup_watchdog_timer();
    },
    core_unpaired: function(core_) {
        core = undefined;
        console.log("Core unpaired!");

        clear_watchdog_timer();
        installer.restart_manager();
    }
});

var ext_settings = roon.load_config("settings") || {
    update_time: "02:00",
    logging:     false
};

var svc_settings = new RoonApiSettings(roon, {
    get_settings: function(cb) {
        pending_actions = {};           // Start off with a clean list
        cb(makelayout(ext_settings));
    },
    save_settings: function(req, isdryrun, settings) {
        update_pending_actions(settings.values);

        let l = makelayout(settings.values);
        req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

        if (!isdryrun && !l.has_error) {
            ext_settings = l.values;
            svc_settings.update_settings(l);
            roon.save_config("settings", ext_settings);

            installer.set_log_state(ext_settings.logging);
            set_update_timer();
            perform_pending_actions();
        }
    }
});

var svc_status = new RoonApiStatus(roon);
var timer = new ApiTimeInput();

var installer = new ApiExtensionInstaller({
    repository_changed: function(values) {
        category_list = values;
    },
    installs_changed: function(installed) {
        console.log(installed);
    },
    updates_changed: function(updates) {
        console.log(updates);
    },
    status_changed: function(message, is_error) {
        if (core == undefined) {
            roon.start_discovery();
        }

        svc_status.set_status(message, is_error);

        last_message = message;
        last_is_error = is_error;
    }
}, ext_settings.logging, process.argv[3] != 'service');

roon.init_services({
    provided_services: [ svc_settings, svc_status ]
});

function makelayout(settings) {
    let l = {
        values:    settings,
        layout:    [],
        has_error: false
    };

    let global = {
        type:    "group",
        title:   "[GLOBAL SETTINGS]",
        items:   []
    };
    let update = {
        type:    "string",
        title:   "Check for updates @ [hh:mm]",
        setting: "update_time"
    };
    const logging = {
        type:    "dropdown",
        title:   "Logging (change forces restart)",
        values:  [
            { title: "Disabled", value: false },
            { title: "Enabled",  value: true  }
        ],
        setting: "logging"
    };
    let category = {
        type:    "dropdown",
        title:   "Category",
        values:  [{ title: "(select category)", value: undefined }],
        setting: "selected_category"
    };
    let selector = {
        type:    "dropdown",
        title:   "Extension",
        values:  [{ title: "(select extension)", value: undefined }],
        setting: "selected_extension"
    };
    let extension = {
        type:    "group",
        title:   "(no extension selected)",
        items:   [],
    };
    let status_string = {
        type:    "label",
    };
    let action = {
        type:    "dropdown",
        title:   "Action",
        values:  [{ title: "(select action)", value: undefined }],
        setting: "action"
    }

    let features = installer.get_features();

    if (features.auto_update != 'off') {
        global.items.push(update);
    }

    if (features.log_mode != 'off') {
        if (settings.logging === undefined) {
            settings.logging = false;
        }

        global.items.push(logging);
    }

    if (settings.update_time) {
        let valid_time = timer.validate_time_string(settings.update_time);

        if (valid_time) {
            settings.update_time = valid_time.friendly;
        } else {
            update.error = "Time should conform to format: hh:mm[am|pm]";
            l.has_error = true;
        }
    }

    let category_index = settings.selected_category;
    category.values = category.values.concat(category_list);

    if (category_index !== undefined) {
        extension_list = installer.get_extensions_by_category(category_index);
        selector.values = selector.values.concat(extension_list);
        selector.title = category_list[category_index].title + ' Extension';

        let name = undefined;

        for (let i = 0; i < extension_list.length; i++) {
            if (extension_list[i].value == settings.selected_extension) {
                name = settings.selected_extension;
                break;
            }
        }

        if (name !== undefined) {
            const status = installer.get_status(name);
            let details = installer.get_details(name);

            if (details.description) {
                extension.title = details.description;
            } else {
                extension.title = "(no description)";
            }

            status_string.title  = status.state.toUpperCase();
            status_string.title += (status.logging ? " (with logging)" : "");
            status_string.title += (status.version ? ": version " + status.version : "");

            if (is_pending(name)) {
                action_list = [{ title: 'Revert Action', value: ACTION_NO_CHANGE }];
            } else {
                action_list = installer.get_actions(name);
            }

            action.values = action.values.concat(action_list);

            extension.items.push({
                type: "label",
                title: "by: " + details.author
            });
            extension.items.push(status_string);
            if (action.values.length > 1) {
                extension.items.push(action);
            }
        } else {
            settings.selected_extension = undefined;
        }
    }

    if (global.items.length) {
        l.layout.push(global);
    }

    l.layout.push({
        type:  "group",
        title: "[EXTENSION]",
        items: [category, selector, extension]
    });

    l.layout.push({
        type:    "group",
        title:   "[PENDING ACTIONS]",
        items:   [{
            type : "label",
            title: get_pending_actions_string()
        }]
    });

    return l;
}

function is_pending(name) {
    return pending_actions[name];
}

function update_pending_actions(settings) {
    let name = settings.selected_extension;
    let action = settings.action;

    if (action !== undefined) {
        if (action === ACTION_NO_CHANGE) {
            // Remove action from pending_actions
            delete pending_actions[name];
        } else {
            // Update pending actions
            for (let i = 0; i < action_list.length; i++) {
                if (action_list[i].value === action) {
                    let friendly = action_list[i].title + " " + installer.get_details(name).display_name;

                    pending_actions[name] = {
                        action: action,
                        friendly: friendly
                    };

                    break;
                }
            }
        }

        // Cleanup action
        delete settings["action"];
    }
}

function get_pending_actions_string() {
    let pending_actions_string = ""

    for (let name in pending_actions) {
        pending_actions_string += pending_actions[name].friendly + "\n";
    }

    if (!pending_actions_string) {
        pending_actions_string = "(none)";
    }

    return pending_actions_string;
}

function perform_pending_actions() {
    for (const name in pending_actions) {
        installer.perform_action(pending_actions[name].action, name);
    }
}

function set_update_timer() {
    let valid_time = timer.validate_time_string(ext_settings.update_time);

    if (valid_time) {
        const now = Date.now();
        let date = new Date(now);
        let tz_offset = date.getTimezoneOffset();

        date.setSeconds(0);
        date.setMilliseconds(0);
        date.setHours(valid_time.hours);
        date.setMinutes(valid_time.minutes);

        let timeout_time = date.getTime();

        if (timeout_time < now) {
            // Time has passed for today
            timeout_time += 24 * 60 * 60 * 1000;
        }

        date = new Date(timeout_time);
        tz_offset -= date.getTimezoneOffset();

        if (tz_offset) {
            timeout_time -= tz_offset * 60 * 1000;
        }

        timeout_time -= now;

        if (timeout_id != null) {
            // Clear pending timeout
            clearTimeout(timeout_id);
        }

        timeout_id = setTimeout(timer_timed_out, timeout_time);
    } else {
        // Clear pending timeout
        clearTimeout(timeout_id);
        timeout_id = null;
    }
}

function timer_timed_out() {
    timeout_id = null;

    console.log("It's update time!");
    installer.update_all();

    set_update_timer();
}

function setup_watchdog_timer() {
    clear_watchdog_timer();

    watchdog_timer_id = setInterval(kick_watchdog, 60000);
}

function kick_watchdog() {
    // Check if the Roon API is still running fine by refreshing the status message
    svc_status.set_status(last_message, last_is_error);
}

function clear_watchdog_timer() {
    if (watchdog_timer_id) {
        clearInterval(watchdog_timer_id);
    }
}

function init() {
    let os = require("os");
    let hostname = os.hostname().split(".")[0];

    roon.extension_reginfo.extension_id += "." + hostname;
    roon.extension_reginfo.display_name += " @" + hostname;

    set_update_timer();
}

init();
