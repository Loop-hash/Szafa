package pl.szafa.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Co ok. 4 godziny pobiera aktualne ceny (data/prices.json z repo) i porównuje z obserwowanymi
 * rzeczami. Gdy cena spadła poniżej zapamiętanej, wysyła powiadomienie i zapamiętuje nową cenę.
 */
public class WatchReceiver extends BroadcastReceiver {

    static final String PREFS = "SzafaWatch";
    static final String ACTION = "pl.szafa.app.WATCH";
    private static final String CHANNEL = "ceny";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (!ACTION.equals(a)) { schedule(ctx); return; }
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try { check(ctx); } finally { pr.finish(); }
        }).start();
    }

    static void schedule(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        Intent i = new Intent(ctx, WatchReceiver.class).setAction(ACTION);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        long every = 4L * 60 * 60 * 1000;
        am.setInexactRepeating(AlarmManager.RTC, System.currentTimeMillis() + every, every, pi);
    }

    static int check(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String url = p.getString("url", "");
        if (url.isEmpty()) return 0;
        try {
            JSONArray items = new JSONArray(p.getString("items", "[]"));
            if (items.length() == 0) return 0;
            JSONObject prices = new JSONObject(get(url)).optJSONObject("p");
            if (prices == null) return 0;
            JSONObject last = new JSONObject(p.getString("last", "{}"));
            int found = 0;
            for (int k = 0; k < items.length(); k++) {
                JSONObject it = items.getJSONObject(k);
                String id = it.optString("id");
                if (!prices.has(id)) continue;
                double now = prices.getDouble(id);
                double ref = last.has(id) ? last.getDouble(id) : it.optDouble("price", now);
                if (now < ref - 0.009) {
                    found++;
                    notify(ctx, id.hashCode(), it.optString("brand", "Szafa"),
                        it.optString("title", "Obserwowana rzecz") + ": " + fmt(ref) + " → " + fmt(now) + " zł");
                }
                last.put(id, now);
            }
            p.edit().putString("last", last.toString()).apply();
            return found;
        } catch (Exception e) {
            return 0;
        }
    }

    private static String fmt(double v) {
        return (v == Math.floor(v)) ? String.valueOf((long) v) : String.format(java.util.Locale.ROOT, "%.2f", v).replace('.', ',');
    }

    private static void notify(Context ctx, int id, String title, String text) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Spadki cen", NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE);
        nm.notify(id, new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build());
    }

    private static String get(String u) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] b = new byte[16384];
            int n;
            while ((n = in.read(b)) > 0) o.write(b, 0, n);
            return o.toString("UTF-8");
        } finally {
            c.disconnect();
        }
    }
}
