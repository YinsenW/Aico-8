package dev.aico8.research;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity implements AudioManager.OnAudioFocusChangeListener {
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(this)
                .build();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        requestGameAudioFocus();
    }

    @Override
    public void onPause() {
        abandonGameAudioFocus();
        super.onPause();
    }

    @Override
    public void onAudioFocusChange(int focusChange) {
        boolean hasFocus = focusChange == AudioManager.AUDIOFOCUS_GAIN;
        dispatchAudioFocus(hasFocus);
    }

    private void requestGameAudioFocus() {
        if (audioManager == null) return;
        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            result = audioManager.requestAudioFocus(audioFocusRequest);
        } else {
            result = audioManager.requestAudioFocus(this, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
        dispatchAudioFocus(result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
    }

    private void abandonGameAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        } else {
            audioManager.abandonAudioFocus(this);
        }
        dispatchAudioFocus(false);
    }

    private void dispatchAudioFocus(boolean hasFocus) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        String script = "window.dispatchEvent(new CustomEvent('aico8:audio-focus',{detail:{hasFocus:"
            + (hasFocus ? "true" : "false") + "}}));";
        getBridge().executeOnMainThread(() -> getBridge().getWebView().evaluateJavascript(script, null));
    }
}
