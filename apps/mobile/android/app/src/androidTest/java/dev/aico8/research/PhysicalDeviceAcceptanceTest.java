package dev.aico8.research;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom;
import static org.junit.Assert.assertEquals;

import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

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
}
