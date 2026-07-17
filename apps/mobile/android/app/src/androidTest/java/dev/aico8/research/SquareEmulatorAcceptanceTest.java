package dev.aico8.research;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.util.DisplayMetrics;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public final class SquareEmulatorAcceptanceTest {
    private static final int SQUARE_EDGE_PX = 1024;

    @Test
    public void localWebHostLoadsAtSquareResolutionAndPreservesStorage() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> webView = captureSquareWebView(scenario);
            awaitJavascriptTrue(webView.get(), "document.querySelector('.player-shell') !== null");
            assertEquals(
                "true",
                evaluateJavascript(
                    webView.get(),
                    "location.protocol === 'https:' && location.hostname === 'localhost'"
                )
            );

            assertEquals(
                "\"square-acceptance\"",
                evaluateJavascript(
                    webView.get(),
                    "localStorage.setItem('aico8-square-acceptance', 'square-acceptance'); " +
                        "localStorage.getItem('aico8-square-acceptance')"
                )
            );

            assertEquals(
                "0",
                evaluateJavascript(
                    webView.get(),
                    "window.__aico8TouchCount = 0; " +
                        "document.addEventListener('click', () => window.__aico8TouchCount += 1, " +
                        "{ once: true }); window.__aico8TouchCount"
                )
            );
            onView(isAssignableFrom(WebView.class)).perform(click());
            awaitJavascriptTrue(webView.get(), "window.__aico8TouchCount === 1");

            scenario.recreate();
            webView = captureSquareWebView(scenario);
            awaitJavascriptTrue(webView.get(), "document.querySelector('.player-shell') !== null");
            assertEquals(
                "\"square-acceptance\"",
                evaluateJavascript(
                    webView.get(),
                    "localStorage.getItem('aico8-square-acceptance')"
                )
            );
        }
    }

    private static AtomicReference<WebView> captureSquareWebView(
        ActivityScenario<MainActivity> scenario
    ) {
        AtomicReference<WebView> webView = new AtomicReference<>();
        scenario.onActivity(activity -> {
            DisplayMetrics metrics = new DisplayMetrics();
            activity.getWindowManager().getDefaultDisplay().getRealMetrics(metrics);
            assertEquals(SQUARE_EDGE_PX, metrics.widthPixels);
            assertEquals(SQUARE_EDGE_PX, metrics.heightPixels);
            webView.set(activity.getBridge().getWebView());
        });
        return webView;
    }

    private static void awaitJavascriptTrue(WebView webView, String expression) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        String result = "false";
        while (System.nanoTime() < deadline) {
            result = evaluateJavascript(webView, expression);
            if ("true".equals(result)) return;
            Thread.sleep(100);
        }
        assertTrue("JavaScript condition did not become true; last result=" + result, false);
    }

    private static String evaluateJavascript(WebView webView, String script) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            webView.evaluateJavascript(script, value -> {
                result.set(value);
                completed.countDown();
            })
        );
        assertTrue("Timed out evaluating JavaScript", completed.await(10, TimeUnit.SECONDS));
        return result.get();
    }
}
