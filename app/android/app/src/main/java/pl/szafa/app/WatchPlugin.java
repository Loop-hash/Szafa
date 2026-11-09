package pl.szafa.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lista obserwowanych rzeczy przekazana z apki do części natywnej (sprawdza ją WatchReceiver). */
@CapacitorPlugin(name = "Watch")
public class WatchPlugin extends Plugin {

    @PluginMethod
    public void set(PluginCall call) {
        JSArray items = call.getArray("items");
        String url = call.getString("url", "");
        Context ctx = getContext();
        ctx.getSharedPreferences(WatchReceiver.PREFS, Context.MODE_PRIVATE).edit()
            .putString("items", items == null ? "[]" : items.toString())
            .putString("url", url)
            .apply();
        WatchReceiver.schedule(ctx);
        call.resolve();
    }

    @PluginMethod
    public void askNotify(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getActivity() != null
            && getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            getActivity().requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 77);
        }
        call.resolve();
    }

    @PluginMethod
    public void checkNow(PluginCall call) {
        new Thread(() -> {
            int n = WatchReceiver.check(getContext());
            JSObject r = new JSObject();
            r.put("found", n);
            call.resolve(r);
        }).start();
    }
}
