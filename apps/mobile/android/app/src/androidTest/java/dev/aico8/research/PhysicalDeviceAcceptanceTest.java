package dev.aico8.research;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom;
import static org.junit.Assert.assertEquals;

import android.content.pm.ActivityInfo;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public final class PhysicalDeviceAcceptanceTest {
    @Test
    public void localHostTouchAndStorageSurviveOnDevice() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> webView = SquareEmulatorAcceptanceTest.captureWebView(scenario);
            SquareEmulatorAcceptanceTest.awaitJavascriptTrue(
                webView.get(),
                "document.querySelector('.player-shell') !== null"
            );
            assertEquals(
                "true",
                SquareEmulatorAcceptanceTest.evaluateJavascript(
                    webView.get(),
                    "location.protocol === 'https:' && location.hostname === 'localhost'"
                )
            );
            assertEquals(
                "\"physical-acceptance\"",
                SquareEmulatorAcceptanceTest.evaluateJavascript(
                    webView.get(),
                    "localStorage.setItem('aico8-physical-acceptance', 'physical-acceptance'); " +
                        "localStorage.getItem('aico8-physical-acceptance')"
                )
            );
            assertEquals(
                "0",
                SquareEmulatorAcceptanceTest.evaluateJavascript(
                    webView.get(),
                    "window.__aico8PhysicalTouchCount = 0; " +
                        "const markAico8PhysicalTouch = () => window.__aico8PhysicalTouchCount += 1; " +
                        "document.addEventListener('touchstart', markAico8PhysicalTouch, " +
                        "{ once: true, capture: true, passive: true }); " +
                        "document.addEventListener('pointerdown', markAico8PhysicalTouch, " +
                        "{ once: true, capture: true }); window.__aico8PhysicalTouchCount"
                )
            );
            onView(isAssignableFrom(WebView.class)).perform(click());
            SquareEmulatorAcceptanceTest.awaitJavascriptTrue(
                webView.get(),
                "window.__aico8PhysicalTouchCount >= 1"
            );

            scenario.recreate();
            webView = SquareEmulatorAcceptanceTest.captureWebView(scenario);
            SquareEmulatorAcceptanceTest.awaitJavascriptTrue(
                webView.get(),
                "document.querySelector('.player-shell') !== null"
            );
            assertEquals(
                "\"physical-acceptance\"",
                SquareEmulatorAcceptanceTest.evaluateJavascript(
                    webView.get(),
                    "localStorage.getItem('aico8-physical-acceptance')"
                )
            );
            SquareEmulatorAcceptanceTest.captureReadyHostEvidence(
                scenario,
                "physical-host.png"
            );
        }
    }

    @Test
    public void userOrientationRequestsPreserveHostState() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> webView = SquareEmulatorAcceptanceTest.captureWebView(scenario);
            SquareEmulatorAcceptanceTest.awaitJavascriptTrue(
                webView.get(),
                "document.querySelector('.player-shell') !== null"
            );
            assertEquals(
                "\"orientation-acceptance\"",
                SquareEmulatorAcceptanceTest.evaluateJavascript(
                    webView.get(),
                    "localStorage.setItem('aico8-orientation-acceptance', 'orientation-acceptance'); " +
                        "localStorage.getItem('aico8-orientation-acceptance')"
                )
            );

            requestOrientation(scenario, ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
            SquareEmulatorAcceptanceTest.awaitJavascriptTrue(
                webView.get(),
                "document.querySelector('.player-shell') !== null && " +
                    "localStorage.getItem('aico8-orientation-acceptance') === 'orientation-acceptance'"
            );
            requestOrientation(scenario, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
            SquareEmulatorAcceptanceTest.awaitJavascriptTrue(
                webView.get(),
                "document.querySelector('.player-shell') !== null && " +
                    "localStorage.getItem('aico8-orientation-acceptance') === 'orientation-acceptance'"
            );

            scenario.onActivity(activity -> {
                File output = new File(activity.getFilesDir(), "physical-orientation.json");
                String evidence = "{\"schemaVersion\":\"aico8.android-orientation-evidence.v1\"," +
                    "\"requestedLandscape\":true,\"requestedPortrait\":true," +
                    "\"hostStatePreserved\":true}\n";
                try (FileOutputStream stream = new FileOutputStream(output)) {
                    stream.write(evidence.getBytes(StandardCharsets.UTF_8));
                } catch (Exception error) {
                    throw new AssertionError("Unable to retain orientation evidence", error);
                }
                activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER);
            });
        }
    }

    private static void requestOrientation(
        ActivityScenario<MainActivity> scenario,
        int requestedOrientation
    ) throws Exception {
        scenario.onActivity(activity -> {
            activity.setRequestedOrientation(requestedOrientation);
            assertEquals(requestedOrientation, activity.getRequestedOrientation());
        });
        Thread.sleep(500);
    }
}
