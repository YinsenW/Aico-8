package dev.aico8.research;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import android.content.pm.ActivityInfo;

import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class MainActivityLifecycleTest {
    @Test
    public void hostSurvivesPauseResumeWithUserOrientation() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                assertEquals(
                    ActivityInfo.SCREEN_ORIENTATION_USER,
                    activity.getRequestedOrientation()
                );
                assertNotNull(activity.getBridge());
                assertNotNull(activity.getBridge().getWebView());
            });

            SquareEmulatorAcceptanceTest.awaitJavascriptTrue(
                SquareEmulatorAcceptanceTest.captureWebView(scenario).get(),
                "document.querySelector('.player-shell') !== null"
            );

            scenario.moveToState(Lifecycle.State.STARTED);
            scenario.moveToState(Lifecycle.State.RESUMED);
        }
    }
}
