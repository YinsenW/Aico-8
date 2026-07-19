package dev.aico8.research;

import static org.junit.Assert.assertTrue;

import android.os.Handler;
import android.os.HandlerThread;
import android.view.FrameMetrics;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public final class SquareEmulatorPerformanceTest {
    private static final int CAPTURE_MILLISECONDS = 60_000;

    @Test
    public void animatedWebViewSustainsAFullMeasurementWindow() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> webView = SquareEmulatorAcceptanceTest.captureWebView(scenario);
            SquareEmulatorAcceptanceTest.awaitJavascriptTrue(
                webView.get(),
                "document.querySelector('.player-shell') !== null"
            );
            List<Double> frameDurationsMilliseconds = new ArrayList<>();
            HandlerThread metricsThread = new HandlerThread("aico8-frame-metrics");
            metricsThread.start();
            Handler metricsHandler = new Handler(metricsThread.getLooper());
            AtomicReference<Window.OnFrameMetricsAvailableListener> listener = new AtomicReference<>();
            scenario.onActivity(activity -> {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                webView.get().setKeepScreenOn(true);
                Window.OnFrameMetricsAvailableListener value = (window, metrics, dropped) -> {
                    long duration = metrics.getMetric(FrameMetrics.TOTAL_DURATION);
                    if (duration > 0) {
                        synchronized (frameDurationsMilliseconds) {
                            frameDurationsMilliseconds.add(duration / 1_000_000.0);
                        }
                    }
                };
                listener.set(value);
                activity.getWindow().addOnFrameMetricsAvailableListener(value, metricsHandler);
            });
            SquareEmulatorAcceptanceTest.evaluateJavascript(
                webView.get(),
                "window.__aico8PerformanceFrames = 0; " +
                    "window.__aico8PerformanceDone = false; " +
                    "const marker = document.createElement('span'); " +
                    "marker.id = 'aico8-emulator-performance-marker'; " +
                    "marker.style.cssText = 'position:fixed;left:8px;top:8px;width:8px;height:8px;' + " +
                    "'background:#ff5d9e;opacity:0.25;z-index:2147483647;will-change:transform'; " +
                    "document.body.appendChild(marker); " +
                    "const started = performance.now(); " +
                    "const sample = now => { " +
                    "window.__aico8PerformanceFrames += 1; " +
                    "marker.style.transform = 'translateX(' + " +
                    "String(window.__aico8PerformanceFrames % 48) + 'px)'; " +
                    "if (now - started >= " + CAPTURE_MILLISECONDS + ") { " +
                    "window.__aico8PerformanceDone = true; return; } " +
                    "requestAnimationFrame(sample); }; requestAnimationFrame(sample); true"
            );
            int frames = 0;
            try {
                SquareEmulatorAcceptanceTest.awaitJavascriptTrue(
                    webView.get(),
                    "window.__aico8PerformanceDone === true",
                    75
                );
                frames = Integer.parseInt(
                    SquareEmulatorAcceptanceTest.evaluateJavascript(
                        webView.get(),
                        "String(window.__aico8PerformanceFrames)"
                    ).replace("\"", "")
                );
            } finally {
                final int observedAnimationFrames = frames;
                scenario.onActivity(activity -> {
                    Window.OnFrameMetricsAvailableListener value = listener.get();
                    if (value != null) {
                        activity.getWindow().removeOnFrameMetricsAvailableListener(value);
                    }
                    StringBuilder evidence = new StringBuilder("duration_milliseconds\n");
                    synchronized (frameDurationsMilliseconds) {
                        for (double duration : frameDurationsMilliseconds) {
                            evidence.append(duration).append('\n');
                        }
                    }
                    File output = new File(activity.getFilesDir(), "emulator-frame-durations.csv");
                    File summary = new File(activity.getFilesDir(), "emulator-animation-summary.txt");
                    try (FileOutputStream stream = new FileOutputStream(output);
                         FileOutputStream summaryStream = new FileOutputStream(summary)) {
                        stream.write(evidence.toString().getBytes(StandardCharsets.UTF_8));
                        summaryStream.write(
                            ("request_animation_frame_callbacks=" + observedAnimationFrames + "\n" +
                                "window_seconds=60\n").getBytes(StandardCharsets.UTF_8)
                        );
                    } catch (Exception error) {
                        throw new AssertionError("Unable to retain emulator frame evidence", error);
                    }
                });
                metricsThread.quitSafely();
                metricsThread.join(5_000);
            }
            assertTrue("Expected at least 210 requestAnimationFrame callbacks in 60 seconds", frames >= 210);
        }
    }
}
