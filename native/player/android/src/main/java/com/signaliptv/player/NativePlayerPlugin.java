package com.signaliptv.player;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens the full-screen Media3 player.
 *
 * play({ items: [{url, title, subtitle, headers}], index, startMs, live, userAgent, resizeMode, buffer })
 * resolves when the player closes with { position, duration, index, ended, error }.
 */
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    @PluginMethod
    public void play(PluginCall call) {
        JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) {
            call.reject("Nothing to play");
            return;
        }
        // Channel lists can be large, so the payload is handed over in memory instead of through the Intent.
        PlayerActivity.pendingPayload = call.getData().toString();
        Intent intent = new Intent(getContext(), PlayerActivity.class);
        startActivityForResult(call, intent, "onPlayerClosed");
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        call.resolve(ret);
    }

    @ActivityCallback
    private void onPlayerClosed(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (data != null) {
            ret.put("position", data.getLongExtra("position", 0));
            ret.put("duration", data.getLongExtra("duration", 0));
            ret.put("index", data.getIntExtra("index", 0));
            ret.put("ended", data.getBooleanExtra("ended", false));
            String error = data.getStringExtra("error");
            if (error != null) ret.put("error", error);
        }
        call.resolve(ret);
    }
}
