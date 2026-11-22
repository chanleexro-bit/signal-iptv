package com.signaliptv.player;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/** Full-screen player for live channels, movies and episodes, built on Media3 (ExoPlayer). */
@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends AppCompatActivity {

    /** Set by NativePlayerPlugin right before this activity starts. */
    static volatile String pendingPayload;

    private static final int ACCENT = Color.rgb(255, 90, 63);
    private static final String[] RESIZE_LABELS = {"Fit", "Fill", "Zoom"};
    private static final int[] RESIZE_MODES = {
            AspectRatioFrameLayout.RESIZE_MODE_FIT,
            AspectRatioFrameLayout.RESIZE_MODE_FILL,
            AspectRatioFrameLayout.RESIZE_MODE_ZOOM
    };

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<String> urls = new ArrayList<>();
    private final List<String> titles = new ArrayList<>();
    private final List<String> subtitles = new ArrayList<>();
    private final Map<String, String> headers = new HashMap<>();

    private boolean live;
    private String userAgent;
    private String buffer = "normal";
    private int resizeIndex = 0;

    private int startIndex = 0;
    private long startMs = 0;
    private boolean ended = false;
    private String lastError = null;

    private ExoPlayer player;
    private PlayerView playerView;
    private LinearLayout topBar;
    private TextView titleView;
    private TextView subtitleView;
    private TextView resizeButton;
    private TextView messageView;
    private TextView zapView;

    private int retries = 0;
    private int hlsRetryIndex = -1;

    private final Runnable hideZap = () -> { if (zapView != null) zapView.setVisibility(View.GONE); };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.BLACK));

        if (!readPayload(savedInstanceState)) {
            finishWithResult("Nothing to play");
            return;
        }
        buildLayout();
        enterImmersive();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (playerView != null && playerView.isControllerFullyVisible()) {
                    playerView.hideController();
                } else {
                    finishWithResult(null);
                }
            }
        });
    }

    // ---------- payload ----------

    private boolean readPayload(Bundle saved) {
        String json = pendingPayload;
        if (saved != null && saved.getString("payload") != null) json = saved.getString("payload");
        if (json == null) return false;
        try {
            JSONObject o = new JSONObject(json);
            JSONArray items = o.optJSONArray("items");
            if (items == null || items.length() == 0) return false;
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.getJSONObject(i);
                urls.add(it.optString("url", ""));
                titles.add(it.optString("title", ""));
                subtitles.add(it.optString("subtitle", ""));
                if (i == o.optInt("index", 0)) {
                    JSONObject h = it.optJSONObject("headers");
                    if (h != null) {
                        Iterator<String> keys = h.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            headers.put(k, h.optString(k));
                        }
                    }
                }
            }
            live = o.optBoolean("live", false);
            userAgent = o.optString("userAgent", "");
            buffer = o.optString("buffer", "normal");
            String resize = o.optString("resizeMode", "fit");
            for (int i = 0; i < RESIZE_LABELS.length; i++) {
                if (RESIZE_LABELS[i].equalsIgnoreCase(resize)) resizeIndex = i;
            }
            startIndex = Math.max(0, Math.min(o.optInt("index", 0), urls.size() - 1));
            startMs = Math.max(0, o.optLong("startMs", 0));
            if (saved != null) {
                startIndex = saved.getInt("index", startIndex);
                startMs = saved.getLong("position", startMs);
                resizeIndex = saved.getInt("resize", resizeIndex);
            }
            pendingPayload = json;
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle out) {
        super.onSaveInstanceState(out);
        out.putString("payload", pendingPayload);
        out.putInt("index", currentIndex());
        out.putLong("position", currentPosition());
        out.putInt("resize", resizeIndex);
    }

    // ---------- layout ----------

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private TextView chipButton(String text) {
        TextView b = new TextView(this);
        b.setText(text);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setPadding(dp(14), dp(8), dp(14), dp(8));
        b.setFocusable(true);
        b.setClickable(true);
        GradientDrawable normal = new GradientDrawable();
        normal.setCornerRadius(dp(20));
        normal.setColor(Color.argb(90, 255, 255, 255));
        GradientDrawable focused = new GradientDrawable();
        focused.setCornerRadius(dp(20));
        focused.setColor(ACCENT);
        StateListDrawable bg = new StateListDrawable();
        bg.addState(new int[]{android.R.attr.state_focused}, focused);
        bg.addState(new int[]{android.R.attr.state_pressed}, focused);
        bg.addState(new int[]{}, normal);
        b.setBackground(bg);
        return b;
    }

    private void buildLayout() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        playerView = new PlayerView(this);
        playerView.setKeepScreenOn(true);
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS);
        playerView.setShowSubtitleButton(true);
        playerView.setControllerShowTimeoutMs(4000);
        playerView.setResizeMode(RESIZE_MODES[resizeIndex]);
        playerView.setShowFastForwardButton(!live);
        playerView.setShowRewindButton(!live);
        playerView.setShowNextButton(urls.size() > 1);
        playerView.setShowPreviousButton(urls.size() > 1);
        root.addView(playerView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Top bar: back, title, LIVE badge, picture-size button. Shown together with the controls.
        topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp(16), dp(14), dp(16), dp(28));
        GradientDrawable shade = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{Color.argb(200, 0, 0, 0), Color.TRANSPARENT});
        topBar.setBackground(shade);

        TextView back = chipButton("← Back");
        back.setOnClickListener(v -> finishWithResult(null));
        topBar.addView(back);

        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        texts.setPadding(dp(16), 0, dp(12), 0);
        titleView = new TextView(this);
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 19);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        subtitleView = new TextView(this);
        subtitleView.setTextColor(Color.argb(200, 255, 255, 255));
        subtitleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        subtitleView.setSingleLine(true);
        subtitleView.setEllipsize(TextUtils.TruncateAt.END);
        texts.addView(titleView);
        texts.addView(subtitleView);
        topBar.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        if (live) {
            TextView badge = new TextView(this);
            badge.setText("LIVE");
            badge.setTextColor(Color.WHITE);
            badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            badge.setTypeface(Typeface.DEFAULT_BOLD);
            badge.setLetterSpacing(0.1f);
            badge.setPadding(dp(10), dp(4), dp(10), dp(4));
            GradientDrawable bb = new GradientDrawable();
            bb.setCornerRadius(dp(12));
            bb.setColor(ACCENT);
            badge.setBackground(bb);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = dp(12);
            topBar.addView(badge, lp);
        }

        resizeButton = chipButton("⤢ " + RESIZE_LABELS[resizeIndex]);
        resizeButton.setOnClickListener(v -> {
            resizeIndex = (resizeIndex + 1) % RESIZE_MODES.length;
            playerView.setResizeMode(RESIZE_MODES[resizeIndex]);
            resizeButton.setText("⤢ " + RESIZE_LABELS[resizeIndex]);
        });
        topBar.addView(resizeButton);

        FrameLayout.LayoutParams topLp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP);
        root.addView(topBar, topLp);

        // Channel-change banner (live) and error / status message.
        zapView = new TextView(this);
        zapView.setTextColor(Color.WHITE);
        zapView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        zapView.setTypeface(Typeface.DEFAULT_BOLD);
        zapView.setPadding(dp(18), dp(10), dp(18), dp(10));
        GradientDrawable zb = new GradientDrawable();
        zb.setCornerRadius(dp(10));
        zb.setColor(Color.argb(210, 15, 17, 21));
        zb.setStroke(dp(2), ACCENT);
        zapView.setBackground(zb);
        zapView.setVisibility(View.GONE);
        FrameLayout.LayoutParams zlp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        zlp.topMargin = dp(90);
        root.addView(zapView, zlp);

        messageView = new TextView(this);
        messageView.setTextColor(Color.WHITE);
        messageView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        messageView.setGravity(Gravity.CENTER);
        messageView.setPadding(dp(24), dp(16), dp(24), dp(16));
        GradientDrawable mb = new GradientDrawable();
        mb.setCornerRadius(dp(10));
        mb.setColor(Color.argb(220, 15, 17, 21));
        messageView.setBackground(mb);
        messageView.setVisibility(View.GONE);
        root.addView(messageView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        setContentView(root);

        ViewCompat.setOnApplyWindowInsetsListener(topBar, (v, insets) -> {
            Insets cut = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            v.setPadding(dp(16) + cut.left, dp(14) + cut.top, dp(16) + cut.right, dp(28));
            return insets;
        });

        playerView.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
            topBar.setVisibility(visibility);
            if (visibility != View.VISIBLE) enterImmersive();
        });
        updateTitle(startIndex);
    }

    private void enterImmersive() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    private void updateTitle(int index) {
        if (index < 0 || index >= titles.size()) return;
        titleView.setText(titles.get(index));
        String sub = subtitles.get(index);
        subtitleView.setText(sub);
        subtitleView.setVisibility(TextUtils.isEmpty(sub) ? View.GONE : View.VISIBLE);
    }

    private void showZap(int index) {
        if (!live || zapView == null) return;
        zapView.setText((index + 1) + "   " + titles.get(index));
        zapView.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideZap);
        handler.postDelayed(hideZap, 2500);
    }

    private void showMessage(String text) {
        if (messageView == null) return;
        if (text == null) {
            messageView.setVisibility(View.GONE);
        } else {
            messageView.setText(text);
            messageView.setVisibility(View.VISIBLE);
        }
    }

    // ---------- player ----------

    private MediaItem buildItem(int i, boolean forceHls) {
        String url = urls.get(i);
        MediaItem.Builder b = new MediaItem.Builder().setUri(Uri.parse(url)).setMediaId(String.valueOf(i));
        String lower = url.toLowerCase();
        if (forceHls || lower.contains(".m3u8")) b.setMimeType(MimeTypes.APPLICATION_M3U8);
        if (live) {
            b.setLiveConfiguration(new MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(C.TIME_UNSET).build());
        }
        return b.build();
    }

    private void initializePlayer() {
        if (player != null) return;

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(20000);
        if (!TextUtils.isEmpty(userAgent)) http.setUserAgent(userAgent);
        if (!headers.isEmpty()) http.setDefaultRequestProperties(headers);
        DefaultDataSource.Factory data = new DefaultDataSource.Factory(this, http);

        int min, max, start, rebuffer;
        switch (buffer) {
            case "small": min = 5000; max = 20000; start = 1500; rebuffer = 3000; break;
            case "large": min = 30000; max = 120000; start = 4000; rebuffer = 8000; break;
            default: min = 15000; max = 50000; start = 2500; rebuffer = 5000;
        }
        DefaultLoadControl load = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(min, max, start, rebuffer)
                .build();

        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
                .setEnableDecoderFallback(true)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);

        player = new ExoPlayer.Builder(this, renderers)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(data))
                .setLoadControl(load)
                .setHandleAudioBecomingNoisy(true)
                .build();
        player.setAudioAttributes(new androidx.media3.common.AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build(), true);

        List<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < urls.size(); i++) items.add(buildItem(i, false));

        player.addListener(new Player.Listener() {
            @Override
            public void onMediaItemTransition(MediaItem mediaItem, int reason) {
                int idx = player.getCurrentMediaItemIndex();
                retries = 0;
                showMessage(null);
                updateTitle(idx);
                if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT) showZap(idx);
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) {
                    showMessage(null);
                    lastError = null;
                }
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED && !player.hasNextMediaItem()) {
                    ended = true;
                    finishWithResult(null);
                }
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                handleError(error);
            }
        });

        player.setMediaItems(items, startIndex, live ? C.TIME_UNSET : startMs);
        player.setPlayWhenReady(true);
        player.prepare();
        playerView.setPlayer(player);
        playerView.requestFocus();
    }

    private void handleError(PlaybackException error) {
        if (player == null) return;
        int idx = player.getCurrentMediaItemIndex();
        int code = error.errorCode;

        if (code == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
            player.seekToDefaultPosition();
            player.prepare();
            return;
        }
        // Links without a file extension are often HLS: try that once before giving up.
        boolean formatProblem = code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED
                || code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED;
        if (formatProblem && hlsRetryIndex != idx && !urls.get(idx).toLowerCase().contains(".m3u8")) {
            hlsRetryIndex = idx;
            player.replaceMediaItem(idx, buildItem(idx, true));
            player.prepare();
            return;
        }
        boolean network = code >= 2000 && code < 3000;
        if (live && network && retries < 3) {
            retries++;
            showMessage("Reconnecting…");
            handler.postDelayed(() -> { if (player != null) player.prepare(); }, 2000L * retries);
            return;
        }

        String reason;
        if (code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS) reason = "The server refused this stream. Your account may be expired or at its connection limit.";
        else if (network) reason = "The stream is offline or can’t be reached.";
        else if (code >= 4000 && code < 5000) reason = "This device can’t decode this stream’s video or audio format.";
        else if (formatProblem) reason = "This stream’s format isn’t supported.";
        else reason = "This stream can’t be played.";
        lastError = error.getErrorCodeName();
        String hint = live && urls.size() > 1 ? "\nUse ▲ ▼ or the channel buttons to change channel." : "";
        showMessage(reason + hint);
        playerView.showController();
    }

    private void zap(int delta) {
        if (player == null || urls.size() < 2) return;
        int idx = (player.getCurrentMediaItemIndex() + delta + urls.size()) % urls.size();
        player.seekToDefaultPosition(idx);
        player.prepare();
        player.play();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (event.getAction() == KeyEvent.ACTION_DOWN && player != null) {
            boolean controlsShown = playerView.isControllerFullyVisible();
            if (live && (code == KeyEvent.KEYCODE_CHANNEL_UP || (!controlsShown && code == KeyEvent.KEYCODE_DPAD_UP))) {
                zap(1);
                return true;
            }
            if (live && (code == KeyEvent.KEYCODE_CHANNEL_DOWN || (!controlsShown && code == KeyEvent.KEYCODE_DPAD_DOWN))) {
                zap(-1);
                return true;
            }
            if (!live && !controlsShown && (code == KeyEvent.KEYCODE_DPAD_RIGHT || code == KeyEvent.KEYCODE_DPAD_LEFT)) {
                long step = code == KeyEvent.KEYCODE_DPAD_RIGHT ? 10000 : -10000;
                player.seekTo(Math.max(0, player.getCurrentPosition() + step));
                playerView.showController();
                return true;
            }
            if (code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || code == KeyEvent.KEYCODE_SPACE) {
                if (player.isPlaying()) player.pause(); else player.play();
                playerView.showController();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private int currentIndex() {
        return player != null ? player.getCurrentMediaItemIndex() : startIndex;
    }

    private long currentPosition() {
        return player != null ? Math.max(0, player.getCurrentPosition()) : startMs;
    }

    private void releasePlayer() {
        if (player == null) return;
        startIndex = player.getCurrentMediaItemIndex();
        startMs = Math.max(0, player.getCurrentPosition());
        player.release();
        player = null;
        if (playerView != null) playerView.setPlayer(null);
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (urls.isEmpty()) return;
        initializePlayer();
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersive();
    }

    @Override
    protected void onStop() {
        super.onStop();
        releasePlayer();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        releasePlayer();
        super.onDestroy();
    }

    private void finishWithResult(String error) {
        Intent data = new Intent();
        long duration = 0;
        if (player != null) {
            long d = player.getDuration();
            duration = d == C.TIME_UNSET ? 0 : d;
        }
        data.putExtra("position", currentPosition());
        data.putExtra("duration", duration);
        data.putExtra("index", currentIndex());
        data.putExtra("ended", ended);
        String err = error != null ? error : lastError;
        if (err != null) data.putExtra("error", err);
        setResult(RESULT_OK, data);
        pendingPayload = null;
        finish();
    }
}
