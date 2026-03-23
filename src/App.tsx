/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Document, Packer, Paragraph, TextRun } from 'docx';
import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Link as LinkIcon,
  Play,
  Pause,
  RotateCcw,
  Copy,
  FileText,
  FileCode,
  Cloud,
  Moon,
  Sun,
  Bold,
  Italic,
  Underline,
  Undo,
  Redo,
  Trash2,
  Sparkles,
  CheckCircle2,
  Download,
  ExternalLink,
  Leaf,
  Volume2,
  VolumeX,
  Activity,
  Waves,
  Scissors,
  Wand2,
  Check,
  Zap,
  ZoomIn,
  ZoomOut,
  Music
} from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleGenAI } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as lamejs from 'lamejs';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'upload' | 'drive'>('upload');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [driveLink, setDriveLink] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [briefing, setBriefing] = useState('');
  const [isGeneratingBriefing, setIsGeneratingBriefing] = useState(false);
  const [segments, setSegments] = useState<{ start: number, end: number, text: string, type?: string }[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isNoiseReductionEnabled, setIsNoiseReductionEnabled] = useState(false);
  const [isVolumeBoosted, setIsVolumeBoosted] = useState(false);
  const [isMusicIsolated, setIsMusicIsolated] = useState(false);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [googleTokens, setGoogleTokens] = useState<any>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<{ start: number, end: number } | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [zoom, setZoom] = useState(50);
  const [shareUrl, setShareUrl] = useState('');
  const [hasApiKey, setHasApiKey] = useState(true);
  const [usePaidModel, setUsePaidModel] = useState(false);
  const [transcribeElapsedTime, setTranscribeElapsedTime] = useState(0);
  const [estimatedTranscribeTime, setEstimatedTranscribeTime] = useState<number | null>(null);
  const [transcribeComplete, setTranscribeComplete] = useState(false);
  // localStorage key stores seconds-per-audio-second for self-correcting estimate
  const savedRateKey = 'dharma_scribe_transcribe_rate';
  const getSavedRate = () => parseFloat(localStorage.getItem(savedRateKey) || '0') || null;
  const [userApiKey, setUserApiKey] = useState<string>(() => localStorage.getItem('dharma_user_api_key') || '');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [isFetchingDrive, setIsFetchingDrive] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<any>(null);

  // Check for API key on mount
  useEffect(() => {
    (window as any).seekTo = (time: number) => {
      if (wavesurferRef.current) {
        wavesurferRef.current.setTime(time);
        wavesurferRef.current.play();
        setIsPlaying(true);
      }
    };

    const checkApiKey = async () => {
      if ((window as any).aistudio?.hasSelectedApiKey) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      }
    };
    checkApiKey();
  }, []);

  const handleSetApiKey = async () => {
    if ((window as any).aistudio?.openSelectKey) {
      await (window as any).aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const handleTrim = async () => {
    if (!wavesurferRef.current || !selectedRegion || !audioFile) return;

    setIsTrimming(true);
    try {
      const audioContext = new AudioContext();
      const arrayBuffer = await audioFile.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const start = selectedRegion.start;
      const end = selectedRegion.end;
      const originalDuration = audioBuffer.duration;
      const newDuration = originalDuration - (end - start);
      const sampleRate = audioBuffer.sampleRate;

      const newBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        Math.floor(newDuration * sampleRate),
        sampleRate
      );

      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        const channelData = audioBuffer.getChannelData(i);
        const newChannelData = newBuffer.getChannelData(i);

        const part1Samples = Math.floor(start * sampleRate);
        for (let j = 0; j < part1Samples; j++) {
          newChannelData[j] = channelData[j];
        }

        const part2StartSample = Math.floor(end * sampleRate);
        const part2Samples = channelData.length - part2StartSample;
        for (let j = 0; j < part2Samples; j++) {
          if ((part1Samples + j) < newChannelData.length) {
            newChannelData[part1Samples + j] = channelData[part2StartSample + j];
          }
        }
      }

      // Purify and Convert AudioBuffer to MP3 Blob
      const purifiedBuffer = await applyFiltersToBuffer(newBuffer);
      const mp3Blob = await audioBufferToMp3Blob(purifiedBuffer);
      const baseName = audioFile.name.replace(/\.[^/.]+$/, "");
      const newFile = new File([mp3Blob], `purified_trimmed_${baseName}.mp3`, { type: 'audio/mp3' });

      setAudioFile(newFile);
      if (audioRef.current) {
        audioRef.current.src = URL.createObjectURL(newFile);
      }

      // Clear regions
      const regions = (wavesurferRef.current as any).plugins.find((p: any) => p instanceof RegionsPlugin);
      if (regions) regions.clearRegions();
      setSelectedRegion(null);

    } catch (error) {
      console.error('Trim error:', error);
    } finally {
      setIsTrimming(false);
    }
  };

  const applyFiltersToBuffer = async (buffer: AudioBuffer): Promise<AudioBuffer> => {
    if (!isNoiseReductionEnabled && !isVolumeBoosted) return buffer;

    const offlineCtx = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    let lastNode: AudioNode = source;

    if (isNoiseReductionEnabled) {
      const hp = offlineCtx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 150;

      const lp = offlineCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 7000;

      const peak = offlineCtx.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 3000;
      peak.Q.value = 1;
      peak.gain.value = 5;

      lastNode.connect(hp);
      hp.connect(lp);
      lp.connect(peak);
      lastNode = peak;
    }

    const gain = offlineCtx.createGain();
    gain.gain.value = isVolumeBoosted ? 2.5 : 1.0;

    lastNode.connect(gain);
    gain.connect(offlineCtx.destination);

    source.start(0);
    return await offlineCtx.startRendering();
  };

  const audioBufferToMp3Blob = async (buffer: AudioBuffer): Promise<Blob> => {
    return new Promise((resolve) => {
      const channels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
      const mp3Data: Int8Array[] = [];

      const sampleBlockSize = 1152;
      const left = buffer.getChannelData(0);
      const right = channels > 1 ? buffer.getChannelData(1) : left;

      const floatToInt16 = (f32Array: Float32Array) => {
        let i16 = new Int16Array(f32Array.length);
        for (let i = 0; i < f32Array.length; i++) {
          let s = Math.max(-1, Math.min(1, f32Array[i]));
          i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return i16;
      };

      const leftInt16 = floatToInt16(left);
      const rightInt16 = floatToInt16(right);

      for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
        const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
        const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);

        const mp3buf = channels === 2
          ? mp3encoder.encodeBuffer(leftChunk, rightChunk)
          : mp3encoder.encodeBuffer(leftChunk);

        if (mp3buf.length > 0) {
          mp3Data.push(mp3buf);
        }
      }

      const mp3buf = mp3encoder.flush();
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }

      const blob = new Blob(mp3Data, { type: 'audio/mp3' });
      resolve(blob);
    });
  };

  const audioBufferToWavBlob = (buffer: AudioBuffer): Promise<Blob> => {
    return new Promise((resolve) => {
      const length = buffer.length * buffer.numberOfChannels * 2 + 44;
      const outBuffer = new ArrayBuffer(length);
      const view = new DataView(outBuffer);
      const channels = [];
      let offset = 0;
      let pos = 0;

      // write WAVE header
      setUint32(0x46464952);                         // "RIFF"
      setUint32(length - 8);                         // file length - 8
      setUint32(0x45564157);                         // "WAVE"

      setUint32(0x20746d66);                         // "fmt " chunk
      setUint32(16);                                 // length = 16
      setUint16(1);                                  // PCM (uncompressed)
      setUint16(buffer.numberOfChannels);
      setUint32(buffer.sampleRate);
      setUint32(buffer.sampleRate * 2 * buffer.numberOfChannels); // avg. bytes/sec
      setUint16(buffer.numberOfChannels * 2);        // block-align
      setUint16(16);                                 // 16-bit (hardcoded)

      setUint32(0x61746164);                         // "data" - chunk
      setUint32(length - pos - 4);                   // chunk length

      // write interleaved data
      for (let i = 0; i < buffer.numberOfChannels; i++) {
        channels.push(buffer.getChannelData(i));
      }

      while (pos < buffer.length) {
        for (let i = 0; i < buffer.numberOfChannels; i++) {
          let sample = Math.max(-1, Math.min(1, channels[i][pos]));
          sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
          view.setInt16(offset, sample, true);
          offset += 2;
        }
        pos++;
      }

      resolve(new Blob([outBuffer], { type: "audio/wav" }));

      function setUint16(data: number) {
        view.setUint16(offset, data, true);
        offset += 2;
      }

      function setUint32(data: number) {
        view.setUint32(offset, data, true);
        offset += 4;
      }
    });
  };

  const handleRefine = async () => {
    if (!selectedRegion || !transcript) return;

    setIsRefining(true);
    try {
      const apiKey = getApiKey();
      if (!apiKey) return;

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-latest",
        contents: `Transcript segment to refine: ${transcript.substring(
          Math.floor((selectedRegion.start / duration) * transcript.length),
          Math.floor((selectedRegion.end / duration) * transcript.length)
        )}`,
        config: {
          systemInstruction: "You are an expert audio editor and transcription refiner. Refine the following transcript segment for clarity, grammar, and professional tone while maintaining the original meaning.",
        }
      });

      const refinedText = response.text;

      // Replace the segment in the transcript
      const startIdx = Math.floor((selectedRegion.start / duration) * transcript.length);
      const endIdx = Math.floor((selectedRegion.end / duration) * transcript.length);

      const newTranscript = transcript.substring(0, startIdx) + refinedText + transcript.substring(endIdx);
      setTranscript(newTranscript);

    } catch (error) {
      console.error('Refine error:', error);
    } finally {
      setIsRefining(false);
    }
  };

  const getApiKey = () => {
    // User-supplied key takes priority over environment variable
    if (userApiKey && userApiKey !== 'undefined' && userApiKey !== 'null') return userApiKey;
    const key = process.env.GEMINI_API_KEY || (process.env as any).API_KEY;
    if (!key || key === 'undefined' || key === 'null') return '';
    return key;
  };

  const handleSaveUserApiKey = () => {
    const trimmed = apiKeyInput.trim();
    if (trimmed) {
      localStorage.setItem('dharma_user_api_key', trimmed);
      setUserApiKey(trimmed);
      setApiKeyInput('');
      setShowApiKeyInput(false);
    }
  };

  const handleClearUserApiKey = () => {
    localStorage.removeItem('dharma_user_api_key');
    setUserApiKey('');
    setApiKeyInput('');
  };

  // Convert base64 string + mimeType into a browser File object
  const base64ToFile = (base64: string, mimeType: string, filename: string): File => {
    const byteChars = atob(base64);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    return new File([byteArr], filename, { type: mimeType });
  };

  const handleFetchDriveAudio = async () => {
    if (!driveLink) return;
    const fileId = extractDriveFileId(driveLink);
    if (!fileId) {
      alert('කරුණාකර වලංගු Google Drive ලින්ක් එකක් ඇතුළත් කරන්න.');
      return;
    }
    setIsFetchingDrive(true);
    try {
      const response = await fetch('/api/drive/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, tokens: googleTokens })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || 'Failed to fetch file from Drive');
      }
      const result = await response.json();
      const ext = (result.mimeType || 'audio/mpeg').split('/')[1]?.split(';')[0] || 'mp3';
      const filename = result.name || `drive_audio.${ext}`;
      const file = base64ToFile(result.data, result.mimeType || 'audio/mpeg', filename);
      setAudioFile(file);
      setActiveTab('upload'); // Show all audio controls
    } catch (error: any) {
      console.error('Drive fetch error:', error);
      alert(`ගොනුව බාගත කිරීම අසාර්ථක විය: ${error.message}\n\nකරුණාකර Google Drive ගොනුව "Anyone with the link" ලෙස Public කරන්න.`);
    } finally {
      setIsFetchingDrive(false);
    }
  };

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'si-LK';

      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript && editorRef.current) {
          // Append to editor
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(finalTranscript + ' '));
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          } else {
            editorRef.current.innerText += ' ' + finalTranscript;
          }
          setTranscript(editorRef.current.innerText);
        }
      };

      recognitionRef.current.onend = () => setIsListening(false);
      recognitionRef.current.onerror = () => setIsListening(false);
    }
  }, []);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const hpFilterRef = useRef<BiquadFilterNode | null>(null);
  const lpFilterRef = useRef<BiquadFilterNode | null>(null);
  const peakFilterRef = useRef<BiquadFilterNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Audio Graph Management
  const updateAudioGraph = async () => {
    if (!audioRef.current) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    if (!sourceNodeRef.current) {
      sourceNodeRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
    }

    // Create nodes if they don't exist
    if (!hpFilterRef.current) {
      hpFilterRef.current = audioContextRef.current.createBiquadFilter();
      hpFilterRef.current.type = 'highpass';
      hpFilterRef.current.frequency.value = 150;
    }
    if (!lpFilterRef.current) {
      lpFilterRef.current = audioContextRef.current.createBiquadFilter();
      lpFilterRef.current.type = 'lowpass';
      lpFilterRef.current.frequency.value = 7000;
    }
    if (!peakFilterRef.current) {
      peakFilterRef.current = audioContextRef.current.createBiquadFilter();
      peakFilterRef.current.type = 'peaking';
      peakFilterRef.current.frequency.value = 3000;
      peakFilterRef.current.Q.value = 1;
      peakFilterRef.current.gain.value = 5;
    }
    if (!gainNodeRef.current) {
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = 1.0;
    }

    // Disconnect everything first
    sourceNodeRef.current.disconnect();
    hpFilterRef.current.disconnect();
    lpFilterRef.current.disconnect();
    peakFilterRef.current.disconnect();
    gainNodeRef.current.disconnect();

    // Build the chain based on enabled features
    let lastNode: AudioNode = sourceNodeRef.current;

    if (isNoiseReductionEnabled) {
      lastNode.connect(hpFilterRef.current);
      hpFilterRef.current.connect(lpFilterRef.current);
      lpFilterRef.current.connect(peakFilterRef.current);
      lastNode = peakFilterRef.current;
    }

    // Always include gain node in the chain for volume control/boost
    lastNode.connect(gainNodeRef.current);
    gainNodeRef.current.connect(audioContextRef.current.destination);

    // Update gain value
    gainNodeRef.current.gain.setTargetAtTime(isVolumeBoosted ? 2.5 : 1.0, audioContextRef.current.currentTime, 0.1);
  };

  // Re-run graph update when states change
  useEffect(() => {
    if (audioContextRef.current) {
      updateAudioGraph();
    }
  }, [isNoiseReductionEnabled, isVolumeBoosted]);

  const toggleNoiseReduction = () => {
    setIsNoiseReductionEnabled(!isNoiseReductionEnabled);
    if (!audioContextRef.current) updateAudioGraph();
  };

  const toggleVolumeBoost = () => {
    setIsVolumeBoosted(!isVolumeBoosted);
    if (!audioContextRef.current) updateAudioGraph();
  };

  const toggleMusicIsolation = () => {
    setIsMusicIsolated(!isMusicIsolated);
  };

  const clearAudio = () => {
    setAudioFile(null);
    setDriveLink('');
    setTranscript('');
    setSegments([]);
    setBriefing('');
    if (audioRef.current) {
      audioRef.current.src = '';
    }
  };

  const handleDownloadAudio = () => {
    if (!audioFile) return;
    const url = URL.createObjectURL(audioFile);
    const a = document.createElement('a');
    a.href = url;
    a.download = audioFile.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  // Clean up audio context on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Transcription elapsed timer + self-correcting estimate
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isTranscribing) {
      setTranscribeComplete(false);
      setTranscribeElapsedTime(0);

      // Build estimate: use saved historical rate if available, else fall back to 0.5×
      if (duration > 0) {
        const savedRate = getSavedRate();
        const rate = savedRate ?? 0.5;
        const estimate = Math.max(10, Math.round(duration * rate));
        setEstimatedTranscribeTime(estimate);
      } else {
        setEstimatedTranscribeTime(null);
      }

      interval = setInterval(() => {
        setTranscribeElapsedTime(prev => prev + 1);
      }, 1000);
    } else if (transcribeElapsedTime > 0) {
      // Transcription just finished — freeze the timer and self-correct rate
      setTranscribeComplete(true);
      if (duration > 0 && transcribeElapsedTime > 0) {
        const newRate = transcribeElapsedTime / duration;
        // Blend with previous rate (exponential moving average) for stability
        const savedRate = getSavedRate();
        const blendedRate = savedRate ? savedRate * 0.4 + newRate * 0.6 : newRate;
        localStorage.setItem(savedRateKey, blendedRate.toFixed(4));
      }
    }
    return () => clearInterval(interval);
  }, [isTranscribing]);

  // Theme management
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Google OAuth Listener
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        setGoogleTokens(event.data.tokens);
        // Trigger export after auth success
        handleExportGoogleDocs(event.data.tokens);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [transcript]);

  // Sync WaveSurfer with audio source
  useEffect(() => {
    if (audioFile && wavesurferRef.current) {
      const url = URL.createObjectURL(audioFile);
      wavesurferRef.current.load(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [audioFile]);

  // Sync Playback State
  useEffect(() => {
    if (wavesurferRef.current) {
      if (isPlaying) {
        wavesurferRef.current.play();
      } else {
        wavesurferRef.current.pause();
      }
    }
  }, [isPlaying]);

  // Sync Current Time for highlighting
  useEffect(() => {
    let animationFrameId: number;

    const updateSync = () => {
      if (audioRef.current && isPlaying) {
        const time = audioRef.current.currentTime;
        setCurrentTime(time);

        let index = segments.findIndex((s) => time >= s.start && time <= s.end);

        if (index === -1 && segments.length > 0) {
          for (let i = segments.length - 1; i >= 0; i--) {
            if (time >= segments[i].end && time - segments[i].end < 1.0) {
              index = i;
              break;
            }
          }
        }

        setActiveSegmentIndex(index === -1 ? null : index);
        animationFrameId = requestAnimationFrame(updateSync);
      }
    };

    if (isPlaying) {
      animationFrameId = requestAnimationFrame(updateSync);
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isPlaying, segments]);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!waveformRef.current || !audioRef.current) return;

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      media: audioRef.current,
      waveColor: isDarkMode ? '#4a3728' : '#d4b483',
      progressColor: '#d4af37',
      cursorColor: '#d4af37',
      barWidth: 2,
      barRadius: 3,
      height: 80,
      normalize: true,
      hideScrollbar: false,
    });

    const regions = ws.registerPlugin(RegionsPlugin.create());
    regionsRef.current = regions;
    regions.enableDragSelection({
      color: 'rgba(212, 175, 55, 0.2)',
    });

    regions.on('region-updated', (region) => {
      setSelectedRegion({ start: region.start, end: region.end });
    });

    regions.on('region-created', (region) => {
      // Only allow one region at a time
      regions.getRegions().forEach(r => {
        if (r !== region) r.remove();
      });
      setSelectedRegion({ start: region.start, end: region.end });
    });

    ws.on('interaction', () => {
      if (!isTrimming) {
        regions.clearRegions();
        setSelectedRegion(null);
      }
    });

    wavesurferRef.current = ws;

    ws.on('ready', () => {
      setDuration(ws.getDuration());
    });

    ws.on('timeupdate', (time) => {
      setCurrentTime(time);
    });

    ws.on('interaction', () => {
      setCurrentTime(ws.getCurrentTime());
    });

    ws.on('finish', () => {
      setIsPlaying(false);
    });

    return () => {
      ws.destroy();
    };
  }, [isDarkMode]);

  // Handle Zoom change
  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.zoom(zoom);
    }
  }, [zoom]);

  // Draw annotation regions when segments change
  useEffect(() => {
    if (regionsRef.current && segments.length > 0) {
      // Clear existing annotation regions
      regionsRef.current.getRegions().forEach((r: any) => {
        if (r.id.startsWith('annotation-')) r.remove();
      });

      segments.forEach(segment => {
        if (segment.type && segment.type !== 'normal') {
          let color = 'rgba(212, 175, 55, 0.2)';
          switch (segment.type) {
            case 'name': color = 'rgba(59, 130, 246, 0.4)'; break; // Blue
            case 'slang': color = 'rgba(16, 185, 129, 0.4)'; break; // Green
            case 'inappropriate': color = 'rgba(239, 68, 68, 0.4)'; break; // Red
            case 'silence': color = 'rgba(107, 114, 128, 0.4)'; break; // Gray
          }

          regionsRef.current.addRegion({
            start: segment.start,
            end: segment.end,
            color: color,
            drag: false,
            resize: false,
            id: `annotation-${segment.start}`
          });
        }
      });
    }
  }, [segments]);



  // Dropzone setup
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'audio/*': ['.mp3', '.wav', '.m4a']
    },
    maxFiles: 1,
    multiple: false,
    onDrop: (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        setAudioFile(acceptedFiles[0]);
      }
    }
  } as any);



  useEffect(() => {
    if (audioFile) {
      const url = URL.createObjectURL(audioFile);
      if (audioRef.current) {
        audioRef.current.src = url;
      }
      return () => URL.revokeObjectURL(url);
    }
  }, [audioFile]);

  const togglePlay = () => {
    if (wavesurferRef.current) {
      updateAudioGraph();
      wavesurferRef.current.playPause();
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Helper to extract File ID from Google Drive link
  const extractDriveFileId = (url: string) => {
    const regex = /(?:\/d\/|id=)([\w-]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  // Seek to specific time
  useEffect(() => {
    (window as any).seekTo = (time: number) => {
      if (wavesurferRef.current) {
        wavesurferRef.current.setTime(time);
        wavesurferRef.current.play();
      }
    };
    return () => {
      delete (window as any).seekTo;
    };
  }, []);

  // Transcription Logic
  const handleTranscribe = async () => {
    if (!audioFile && !driveLink) {
      alert('කරුණාකර ශ්රව්ය ගොනුවක් හෝ ලින්ක් එකක් ඇතුළත් කරන්න.');
      return;
    }

    setIsTranscribing(true);
    setTranscript('');
    setSegments([]);

    // Check for paid key if advanced model is selected
    if (usePaidModel && (window as any).aistudio?.hasSelectedApiKey) {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        alert("මෙම උසස් විශේෂාංග (Advanced Mode) සඳහා Paid Tier API Key එකක් අවශ්‍ය වේ. කරුණාකර Header එකෙන් API Key එක තෝරන්න.");
        setIsTranscribing(false);
        return;
      }
    }

    try {
      const apiKey = getApiKey();
      if (!apiKey) {
        if ((window as any).aistudio?.openSelectKey) {
          await (window as any).aistudio.openSelectKey();
          return;
        }
        throw new Error('Gemini API Key is missing.');
      }

      const ai = new GoogleGenAI({ apiKey });

      let audioData = '';
      let mimeType = '';

      if (audioFile) {
        mimeType = audioFile.type || 'audio/mpeg';
        if (audioFile.size > 100 * 1024 * 1024) {
          throw new Error('ගොනුව ඉතා විශාලයි (100MB ට වඩා අඩු විය යුතුය). කරුණාකර කුඩා ගොනුවක් භාවිතා කරන්න.');
        }
        const reader = new FileReader();
        audioData = await new Promise((resolve, reject) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(audioFile);
        });
      } else if (driveLink) {
        // Audio not yet fetched locally — fetch it now, set as audioFile and read from it
        const fileId = extractDriveFileId(driveLink);
        if (!fileId) throw new Error('වලංගු Google Drive ලින්ක් එකක් ඇතුළත් කරන්න.');
        const response = await fetch('/api/drive/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId, tokens: googleTokens })
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorJson;
          try { errorJson = JSON.parse(errorText); } catch (e) {
            throw new Error(`Server error (${response.status}): ${errorText.substring(0, 100)}`);
          }
          throw new Error(errorJson.error || `Server error (${response.status})`);
        }

        const result = await response.json();
        audioData = result.data;
        mimeType = result.mimeType;

        // Also hydrate audioFile so playback / trim work after transcription
        const ext = (result.mimeType || 'audio/mpeg').split('/')[1]?.split(';')[0] || 'mp3';
        const filename = result.name || `drive_audio.${ext}`;
        const fetchedFile = base64ToFile(result.data, result.mimeType || 'audio/mpeg', filename);
        setAudioFile(fetchedFile);
      }

      // Check base64 size (roughly)
      const estimatedSizeMB = (audioData.length * 0.75) / (1024 * 1024);
      if (estimatedSizeMB > 20) {
        console.warn(`Audio data is large (~${estimatedSizeMB.toFixed(1)}MB). This might cause issues with some models.`);
      }

      const response = await ai.models.generateContent({
        model: usePaidModel ? "gemini-3.1-flash-preview" : "gemini-3-flash-preview",
        config: {
          systemInstruction: `You are a professional transcriptionist and audio analyst. Your task is to transcribe the provided audio accurately and identify specific elements. The audio contains mixed Sinhala and English speech. Use Sinhala script for Sinhala words and English script for English words. Provide extremely precise timestamps for every short phrase (2-5 words). Accuracy in timing is critical for synchronization.\n\nAdditionally, identify the following elements and mark them with a 'type' field:\n- 'name': Proper names of people, places, or organizations.\n- 'slang': Informal or slang words.\n- 'inappropriate': Profane, offensive, or inappropriate language.\n- 'silence': Periods of silence longer than 2 seconds (use text: '.............').\n- 'normal': Regular speech.\n\nReturn the transcription as a JSON array of objects with 'start' (number), 'end' (number), 'text' (string), and 'type' (string) fields. Ensure the JSON is valid and follows the schema exactly.${isMusicIsolated ? '\n\nCRITICAL WARNING: The source audio contains background music or songs. You MUST heavily filter out and ignore any background singing, melodies, or lyrics. ONLY transcribe the primary spoken foreground dialogue.' : ''}`,
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                start: { type: "NUMBER", description: "Precise start time in seconds" },
                end: { type: "NUMBER", description: "Precise end time in seconds" },
                text: { type: "STRING", description: "Transcribed text for this short segment" },
                type: { type: "STRING", enum: ["normal", "name", "slang", "inappropriate", "silence"], description: "The type of content in this segment" }
              },
              required: ["start", "end", "text", "type"]
            }
          }
        },
        contents: {
          parts: [
            { inlineData: { data: audioData, mimeType: mimeType } }
          ]
        }
      });

      const result = JSON.parse(response.text || '[]');
      setSegments(result);

      // Generate highlighted HTML for the transcript
      const highlightedHtml = result.map((s: any) => {
        let color = '';
        let title = '';
        switch (s.type) {
          case 'name':
            color = 'bg-blue-200 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200';
            title = 'Name Detected';
            break;
          case 'slang':
            color = 'bg-green-200 dark:bg-green-900/40 text-green-800 dark:text-green-200';
            title = 'Slang Detected';
            break;
          case 'inappropriate':
            color = 'bg-red-200 dark:bg-red-900/40 text-red-800 dark:text-red-200';
            title = 'Inappropriate Language';
            break;
          case 'silence':
            color = 'bg-gray-200 dark:bg-gray-900/40 text-gray-800 dark:text-gray-200 italic opacity-50';
            title = 'Long Silence';
            break;
        }

        const displayText = s.type === 'silence' ? '.............' : s.text;
        if (color) {
          return `<span class="${color} px-1 rounded transition-all cursor-pointer inline-block my-0.5" title="${title}" onclick="window.seekTo(${s.start})">${displayText}</span>`;
        }
        return displayText;
      }).join(' ');

      setTranscript(highlightedHtml);
      if (editorRef.current) {
        editorRef.current.innerHTML = highlightedHtml;
      }

      // Generate Briefing
      const fullText = result.map((s: any) => s.text).join(' ');
      generateBriefing(fullText);
    } catch (error: any) {
      console.error('Transcription error:', error);
      const errorMsg = (error.message || String(error)).toLowerCase();

      if (errorMsg.includes('failed to fetch')) {
        alert('ජාල සම්බන්ධතාවයේ දෝෂයක් (Failed to fetch). කරුණාකර ඔබගේ අන්තර්ජාලය පරීක්ෂා කරන්න හෝ වෙනත් Browser එකකින් උත්සාහ කරන්න. සමහර විට Ad-blockers මඟින් මෙය වැළැක්විය හැක.');
        return;
      }

      if (
        errorMsg.includes('api key not valid') ||
        errorMsg.includes('invalid_argument') ||
        errorMsg.includes('requested entity was not found') ||
        errorMsg.includes('api_key_invalid') ||
        errorMsg.includes('unauthorized')
      ) {
        if ((window as any).aistudio?.openSelectKey) {
          setHasApiKey(false);
          alert('ඔබගේ API Key එක වලංගු නොවේ හෝ නොමැත. කරුණාකර "Set API Key" බොත්තම මඟින් වලංගු Key එකක් තෝරා ගන්න.');
          await (window as any).aistudio.openSelectKey();
          return;
        }
      }

      if (errorMsg.includes('quota exceeded')) {
        alert('ඔබගේ API Key එකේ සීමාව ඉක්මවා ඇත (Quota Exceeded). කරුණාකර මද වේලාවකින් නැවත උත්සාහ කරන්න.');
        return;
      }

      if (errorMsg.includes('overloaded') || errorMsg.includes('service unavailable')) {
        alert('Gemini සේවාව මේ මොහොතේ කාර්යබහුලයි (Overloaded). කරුණාකර මද වේලාවකින් නැවත උත්සාහ කරන්න.');
        return;
      }

      alert(`පරිවර්තනය අසාර්ථක විය: ${error.message || error}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const generateBriefing = async (text: string) => {
    if (!text) return;
    setIsGeneratingBriefing(true);
    try {
      const apiKey = getApiKey();
      if (!apiKey) return;
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: usePaidModel ? "gemini-3.1-flash-preview" : "gemini-3-flash-preview",
        config: {
          systemInstruction: "You are a professional summarizer. Your task is to summarize the following transcribed text into a concise briefing in Sinhala. Highlight the key points and main topics discussed.",
        },
        contents: {
          parts: [{ text: text }]
        }
      });
      setBriefing(response.text || '');
    } catch (error) {
      console.error('Briefing error:', error);
    } finally {
      setIsGeneratingBriefing(false);
    }
  };

  // Render Editor Content with Highlighting
  const renderEditorContent = () => {
    if (!transcript && !isTranscribing) {
      return `<span class="opacity-30 italic pointer-events-none">
        මෙතන තමයි ඔයාගේ සිංහල ට්රාන්ස්ක්රිප්ට් එක එසැණින් ටයිප් වෙලා පේන්න තියෙන්නේ...
      </span>`;
    }

    if (segments.length > 0) {
      return segments.map((segment, index) => {
        const isActive = activeSegmentIndex === index;
        const colorClass = segment.type === 'name' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
          segment.type === 'slang' ? 'bg-green-500/20 text-green-300 border-green-500/30' :
            segment.type === 'inappropriate' ? 'bg-red-500/20 text-red-300 border-red-500/30' :
              segment.type === 'silence' ? 'bg-gray-500/20 text-gray-300 border-gray-500/30' :
                '';

        return `<span 
          id="segment-${index}"
          class="transition-all duration-300 rounded px-1 py-0.5 inline-block cursor-pointer hover:bg-teal-800 ${isActive ? 'bg-spiritual-accent text-black shadow-[0_0_15px_rgba(212,175,55,0.4)] scale-105 z-10' : 'opacity-80'} ${colorClass}"
          onclick="seekTo(${segment.start})"
          title="${segment.type ? segment.type.toUpperCase() : ''}"
        >${segment.type === 'silence' ? '.............' : segment.text}</span>`;
      }).join(' ');
    }

    return transcript;
  };

  // Sync editor content
  useEffect(() => {
    if (editorRef.current) {
      if (isPlaying || document.activeElement !== editorRef.current) {
        const newContent = renderEditorContent();
        if (editorRef.current.innerHTML !== newContent) {
          editorRef.current.innerHTML = newContent;
        }
      }
    }
  }, [transcript, isPlaying, segments, activeSegmentIndex]);

  // Editor Actions
  const handleShare = async () => {
    if (!editorRef.current) return;
    setIsSharing(true);
    try {
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Transcript - ${new Date().toLocaleString()}`,
          transcript: editorRef.current.innerText,
          briefing: briefing
        })
      });
      const data = await response.json();
      if (data.success) {
        const url = `${window.location.origin}?share=${data.id}`;
        setShareUrl(url);
        navigator.clipboard.writeText(url);
        alert('පොදු සබැඳිය පිටපත් කරන ලදී! (Public link copied!)');
      } else {
        alert('සබැඳිය නිර්මාණය කිරීම අසාර්ථක විය.');
      }
    } catch (error) {
      console.error('Share error:', error);
      alert('සබැඳිය නිර්මාණය කිරීමේදී දෝෂයක් ඇති විය.');
    } finally {
      setIsSharing(false);
    }
  };

  // Load shared transcript
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get('share');
    if (shareId) {
      const fetchShared = async () => {
        try {
          const response = await fetch(`/api/share/${shareId}`);
          const data = await response.json();
          if (data.success) {
            setTranscript(data.data.transcript);
            setBriefing(data.data.briefing);
            if (editorRef.current) {
              editorRef.current.innerText = data.data.transcript;
            }
          }
        } catch (error) {
          console.error('Fetch shared error:', error);
        }
      };
      fetchShared();
    }
  }, []);

  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
  };

  const handleCopy = () => {
    if (editorRef.current) {
      navigator.clipboard.writeText(editorRef.current.innerText);
      alert('පෙළ පිටපත් කරන ලදී!');
    }
  };

  const handleExportTxt = () => {
    if (editorRef.current) {
      const audioName = audioFile?.name || 'Audio Transcript';
      const summarySection = briefing ? `Generated Summary\n${'-'.repeat(40)}\n${briefing}\n\n` : '';
      const transcriptSection = `Transcribed Text\n${'-'.repeat(40)}\n${editorRef.current.innerText}`;
      const fullContent = `${audioName}\n${'='.repeat(audioName.length)}\n\n${summarySection}${transcriptSection}`;

      const element = document.createElement("a");
      const file = new Blob([fullContent], { type: 'text/plain' });
      element.href = URL.createObjectURL(file);
      element.download = `${audioName.replace(/\.[^/.]+$/, '') || 'transcript'}.txt`;
      document.body.appendChild(element);
      element.click();
    }
  };

  const handleExportDocx = async () => {
    if (!editorRef.current) return;

    const audioName = audioFile?.name || 'Audio Transcript';
    const children: (Paragraph)[] = [];

    // 1. Audio Name — Bold Title
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: audioName,
            bold: true,
            size: 36,
          }),
        ],
        spacing: { after: 300 },
      })
    );

    // 2. Generated Summary
    if (briefing) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'Generated Summary',
              bold: true,
              size: 26,
            }),
          ],
          spacing: { before: 200, after: 120 },
        })
      );
      briefing.split('\n').forEach(line => {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line, size: 22 })],
            spacing: { after: 80 },
          })
        );
      });
    }

    // 3. Transcribed Text
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'Transcribed Text',
            bold: true,
            size: 26,
          }),
        ],
        spacing: { before: 300, after: 120 },
      })
    );
    editorRef.current.innerText.split('\n').forEach(line => {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 22 })],
          spacing: { after: 80 },
        })
      );
    });

    const doc = new Document({
      sections: [{ properties: {}, children }],
    });

    const blob = await Packer.toBlob(doc);
    const element = document.createElement("a");
    element.href = URL.createObjectURL(blob);
    element.download = `${audioName.replace(/\.[^/.]+$/, '') || 'transcript'}.docx`;
    document.body.appendChild(element);
    element.click();
  };

  const handleExportGoogleDocs = async (tokensOverride?: any) => {
    const tokens = tokensOverride || googleTokens;
    if (!tokens) {
      // Trigger OAuth popup
      try {
        const response = await fetch('/api/auth/google/url');
        const { url } = await response.json();
        window.open(url, 'google_auth', 'width=600,height=700');
      } catch (error) {
        console.error('Auth URL error:', error);
      }
      return;
    }

    setIsExporting(true);
    try {
      const audioName = audioFile?.name || 'Audio Transcript';
      const summarySection = briefing
        ? `Generated Summary\n${'—'.repeat(30)}\n${briefing}\n\n`
        : '';
      const transcriptSection = `Transcribed Text\n${'—'.repeat(30)}\n${editorRef.current?.innerText || ''}`;
      const fullContent = `${summarySection}${transcriptSection}`;

      const response = await fetch('/api/export/google-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokens,
          title: audioName,
          content: fullContent
        })
      });
      const data = await response.json();
      if (data.success) {
        window.open(data.url, '_blank');
      } else {
        alert('Google Doc නිර්මාණය කිරීම අසාර්ථක විය.');
      }
    } catch (error) {
      console.error('Export error:', error);
      alert('අපනයනය කිරීමේදී දෝෂයක් ඇති විය.');
    } finally {
      setIsExporting(false);
    }
  };

  const soundBars = React.useMemo(() => {
    return Array.from({ length: 70 }).map(() => ({
      height: Math.max(15, Math.random() * 100),
      delay: Math.random() * 1.5,
      duration: 0.6 + Math.random() * 0.8
    }));
  }, []);

  return (
    <div className={cn(
      "min-h-screen transition-colors duration-300 font-sans relative overflow-x-hidden",
      isDarkMode ? "bg-spiritual-bg text-teal-100/80" : "bg-teal-50 text-teal-900"
    )}>
      {/* Animated Glowing Sound Wave Background Overlay */}
      <div className="absolute top-0 left-0 w-full h-40 overflow-hidden z-0 pointer-events-none opacity-70 flex items-end justify-center gap-1 md:gap-2 px-4 blur-[1px] shadow-inner">
        {soundBars.map((bar, i) => {
          // Smooth color transition from edge Teal to center Gold
          const distFromCenter = Math.abs(35 - i);
          const bgClass = distFromCenter < 12
            ? "bg-spiritual-accent shadow-[0_0_15px_rgba(250,204,21,0.6)]"
            : distFromCenter < 25
              ? "bg-spiritual-border"
              : "bg-teal-700/50";
          return (
            <div
              key={i}
              className={cn("w-2 md:w-3 rounded-t-full animate-sound-bounce transition-colors", bgClass)}
              style={{
                height: `${bar.height}%`,
                animationDelay: `${bar.delay}s`,
                animationDuration: `${bar.duration}s`
              }}
            />
          );
        })}
      </div>

      {/* Header */}
      <header className="max-w-7xl mx-auto px-6 py-10 flex justify-between items-center border-b border-spiritual-border/50 relative z-10">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-20 h-20 rounded-full flex items-center justify-center shadow-[0_15px_40px_rgba(0,0,0,0.7)] overflow-hidden bg-white/5 border border-spiritual-border/50 transition-all hover:scale-105">
              <img src="/logo.jpg" alt="Mahaguru Dharma Logo" className="w-full h-full object-cover scale-[1.1]" />
            </div>
          </div>
          <div>
            <h1 className={cn(
              "text-3xl font-display font-bold tracking-tight",
              isDarkMode ? "text-teal-100" : "text-teal-900"
            )}>
              MAHAGURU CENTER <span className="text-spiritual-accent">DHARMA SCRIBE</span>
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Leaf className="w-3 h-3 text-spiritual-accent/60" />
              <p className="text-[12px] font-mono uppercase tracking-[0.2em] text-spiritual-accent/80">Serene Processing // v2.5.0</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {(window as any).aistudio?.openSelectKey && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setUsePaidModel(!usePaidModel)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-[12px] font-mono font-bold uppercase tracking-widest rounded-lg transition-all border",
                  usePaidModel
                    ? "bg-spiritual-accent/20 border-spiritual-accent text-spiritual-accent"
                    : "bg-teal-800 border-teal-900/10 text-current opacity-60 hover:border-teal-900/20"
                )}
                title={usePaidModel ? "Using Gemini 3.1 Flash (Advanced)" : "Using Gemini 3 Flash (Standard)"}
              >
                <Zap className={cn("w-3 h-3", usePaidModel && "fill-current")} />
                {usePaidModel ? "Advanced (Paid)" : "Standard (Free)"}
              </button>
              <div className="hidden lg:flex flex-col">
                <span className="text-[10px] font-mono text-current opacity-60 uppercase tracking-tighter">
                  {usePaidModel ? "Gemini 3.1 Flash (High Precision)" : "Gemini 3 Flash (Standard)"}
                </span>
              </div>
              <button
                onClick={handleSetApiKey}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-[12px] font-mono font-bold uppercase tracking-widest rounded-lg transition-all border",
                  hasApiKey
                    ? "bg-teal-800 border-teal-900/10 text-current opacity-80 hover:border-teal-900/20"
                    : "bg-red-900/20 border-red-500 text-red-500 animate-pulse"
                )}
              >
                <Sparkles className="w-3 h-3" />
                {hasApiKey ? "Set API Key" : "Key Required"}
              </button>
            </div>
          )}
          <div className="hidden md:flex flex-col items-end mr-4">
            <span className="text-[12px] font-mono uppercase tracking-widest opacity-70">Scribe</span>
            <span className="text-xs font-mono font-bold text-current opacity-80">KALINDU_M</span>
          </div>

          {/* User API Key Button */}
          <div className="relative">
            <button
              onClick={() => { setShowApiKeyInput(v => !v); setApiKeyInput(''); }}
              className={cn(
                "flex items-center gap-2 px-3 py-2 text-[11px] font-mono font-bold uppercase tracking-widest rounded-lg transition-all border",
                userApiKey
                  ? "bg-green-900/30 border-green-500/50 text-green-400"
                  : "bg-teal-800 border-teal-700/40 text-current opacity-70 hover:opacity-100"
              )}
              title={userApiKey ? "API Key saved — click to change" : "Set your Gemini API Key"}
            >
              <Sparkles className="w-3 h-3" />
              {userApiKey ? 'Key Active' : 'API Key'}
              {userApiKey && <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />}
            </button>

            {/* Collapsible Key Input Panel */}
            <AnimatePresence>
              {showApiKeyInput && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -6 }}
                  className="absolute right-0 top-full mt-2 z-50 w-80 p-4 rounded-xl border border-spiritual-border/60 bg-teal-900 shadow-2xl"
                >
                  <p className="text-[11px] font-mono uppercase tracking-widest opacity-60 mb-3">Gemini API Key</p>
                  {userApiKey && (
                    <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-green-900/30 border border-green-500/30">
                      <span className="w-1.5 h-1.5 bg-green-400 rounded-full flex-shrink-0" />
                      <span className="text-[11px] font-mono text-green-400 truncate flex-1">
                        {userApiKey.slice(0, 8)}{'•'.repeat(12)}{userApiKey.slice(-4)}
                      </span>
                      <button
                        onClick={handleClearUserApiKey}
                        className="text-[10px] font-mono text-red-400 hover:text-red-300 uppercase tracking-widest flex-shrink-0"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={e => setApiKeyInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSaveUserApiKey()}
                      placeholder={userApiKey ? 'Enter new key to replace...' : 'AIza...'}
                      className="flex-1 px-3 py-2 bg-teal-800 border border-teal-700/50 rounded-lg font-mono text-xs focus:ring-2 focus:ring-spiritual-accent outline-none placeholder:opacity-30"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveUserApiKey}
                      disabled={!apiKeyInput.trim()}
                      className="px-3 py-2 bg-spiritual-accent text-black text-[11px] font-mono font-bold uppercase tracking-widest rounded-lg disabled:opacity-40 hover:brightness-110 transition-all"
                    >
                      Save
                    </button>
                  </div>
                  <p className="text-[10px] font-mono opacity-40 mt-2">Stored locally in your browser. Never sent to any server.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-3 spiritual-card hover:bg-teal-700 transition-all group"
          >
            {isDarkMode ? <Sun className="w-5 h-5 text-spiritual-accent" /> : <Moon className="w-5 h-5 text-spiritual-accent" />}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12 space-y-12">

        {/* Input Section */}
        <section className="spiritual-card relative">
          <div className="p-8">
            <div className="flex gap-6 mb-8 border-b border-spiritual-border pb-6">
              <button
                onClick={() => setActiveTab('upload')}
                className={cn(
                  "px-6 py-3 rounded-xl font-display font-bold uppercase tracking-wider transition-all flex items-center gap-3",
                  activeTab === 'upload'
                    ? "bg-spiritual-accent text-black shadow-lg"
                    : "text-current opacity-80 hover:text-teal-600 hover:bg-teal-800"
                )}
              >
                <Upload className="w-5 h-5" />
                Direct Upload
              </button>
              <button
                onClick={() => setActiveTab('drive')}
                className={cn(
                  "px-6 py-3 rounded-xl font-display font-bold uppercase tracking-wider transition-all flex items-center gap-3",
                  activeTab === 'drive'
                    ? "bg-spiritual-accent text-black shadow-lg"
                    : "text-current opacity-80 hover:text-teal-600 hover:bg-teal-800"
                )}
              >
                <LinkIcon className="w-5 h-5" />
                Cloud Link
              </button>
            </div>

            <AnimatePresence mode="wait">
              {activeTab === 'upload' ? (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  {...getRootProps()}
                  className="w-full flex flex-col items-center"
                >
                  <input {...getInputProps()} />
                  <button className="w-full flex items-center justify-center gap-4 py-4 rounded-xl font-display font-bold text-xl uppercase tracking-widest transition-all bg-teal-800 text-teal-100 hover:bg-teal-700 shadow-lg cursor-pointer">
                    <Upload className="w-6 h-6" />
                    {audioFile ? audioFile.name : "Upload Audio File"}
                  </button>
                  {audioFile && (
                    <div className="mt-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); clearAudio(); }}
                        className="px-6 py-2 bg-red-600 text-white rounded-lg text-xs font-mono font-bold uppercase tracking-widest hover:bg-red-500 transition-all shadow-md"
                      >
                        Clear Audio
                      </button>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="drive"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-1 h-4 bg-spiritual-accent rounded-full" />
                    <label className="text-xs font-mono font-bold uppercase tracking-widest text-current opacity-80">Cloud Source Identifier</label>
                  </div>
                  <div className="flex gap-4">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={driveLink}
                        onChange={(e) => setDriveLink(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleFetchDriveAudio()}
                        placeholder="https://drive.google.com/file/d/..."
                        className="w-full px-6 py-4 bg-teal-800 border border-teal-900/10 rounded-2xl font-mono text-sm focus:ring-2 focus:ring-spiritual-accent outline-none transition-all placeholder:opacity-20"
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20">
                        <Cloud className="w-5 h-5" />
                      </div>
                    </div>
                    <button
                      onClick={handleFetchDriveAudio}
                      disabled={isFetchingDrive || !driveLink.trim()}
                      className={cn(
                        "px-8 py-4 rounded-2xl font-display font-bold uppercase tracking-widest transition-all flex items-center gap-2",
                        isFetchingDrive
                          ? "bg-teal-700 text-teal-400 cursor-not-allowed"
                          : "bg-spiritual-accent text-black hover:brightness-110 shadow-lg"
                      )}
                    >
                      {isFetchingDrive ? (
                        <><div className="w-4 h-4 border-2 border-teal-400/30 border-t-teal-300 rounded-full animate-spin" />Fetching...</>
                      ) : (
                        <><Cloud className="w-4 h-4" />Fetch</>
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] font-mono opacity-40 mt-2 text-center">
                    ⓘ Google Drive ගොනුව &quot;Anyone with the link&quot; ලෙස Share කර ඇති බවට සහතික වන්න
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Pre-transcription Audio Controls */}
            {audioFile && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-8 pt-8 border-t border-spiritual-border"
              >
                <div className="flex flex-col md:flex-row items-center gap-8">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={togglePlay}
                      className="w-14 h-14 bg-spiritual-accent text-black rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-lg"
                    >
                      {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
                    </button>
                    <div className="space-y-1">
                      <p className="text-[12px] font-mono uppercase tracking-widest opacity-70">Preview Audio</p>
                      <p className="text-xl font-mono font-bold text-spiritual-accent">{formatTime(currentTime)} / {formatTime(duration)}</p>
                    </div>
                  </div>

                  <div className="flex-1 w-full">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[12px] font-mono uppercase tracking-widest opacity-70">Signal Purification & Enhancement</span>
                      <span className="text-[12px] font-mono uppercase tracking-widest text-spiritual-accent animate-pulse">Inspect Quality Before Scribing</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <button
                        onClick={toggleMusicIsolation}
                        className={cn(
                          "py-4 rounded-xl transition-all flex items-center justify-center gap-3 border font-display font-bold uppercase tracking-widest text-[12px]",
                          isMusicIsolated
                            ? "bg-spiritual-accent/20 border-spiritual-accent text-spiritual-accent shadow-[0_0_15px_rgba(212,175,55,0.3)]"
                            : "bg-teal-800 border-teal-900/10 text-current opacity-80 hover:border-teal-600/40"
                        )}
                      >
                        <Music className={cn("w-4 h-4", isMusicIsolated && "animate-pulse")} />
                        {isMusicIsolated ? "Music Removed" : "Remove Music"}
                      </button>
                      <button
                        onClick={toggleVolumeBoost}
                        className={cn(
                          "py-4 rounded-xl transition-all flex items-center justify-center gap-3 border font-display font-bold uppercase tracking-widest text-[12px]",
                          isVolumeBoosted
                            ? "bg-spiritual-accent/20 border-spiritual-accent text-spiritual-accent shadow-[0_0_15px_rgba(212,175,55,0.3)]"
                            : "bg-teal-800 border-teal-900/10 text-current opacity-80 hover:border-teal-600/40"
                        )}
                      >
                        <Volume2 className={cn("w-4 h-4", isVolumeBoosted && "animate-pulse")} />
                        {isVolumeBoosted ? "Vocals Boosted" : "Boost Vocals"}
                      </button>
                      <button
                        onClick={toggleNoiseReduction}
                        className={cn(
                          "py-4 rounded-xl transition-all flex items-center justify-center gap-3 border font-display font-bold uppercase tracking-widest text-[12px]",
                          isNoiseReductionEnabled
                            ? "bg-spiritual-accent/20 border-spiritual-accent text-spiritual-accent shadow-[0_0_15px_rgba(212,175,55,0.3)]"
                            : "bg-teal-800 border-teal-900/10 text-current opacity-80 hover:border-teal-600/40"
                        )}
                      >
                        <Sparkles className={cn("w-4 h-4", isNoiseReductionEnabled && "animate-pulse")} />
                        {isNoiseReductionEnabled ? "Noise Purified" : "Remove Noise"}
                      </button>
                    </div>
                  </div>
                </div>

                <audio
                  ref={audioRef}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onEnded={() => setIsPlaying(false)}
                  className="hidden"
                />
              </motion.div>
            )}

            <button
              onClick={handleTranscribe}
              disabled={isTranscribing || !audioFile}
              className={cn(
                "w-full mt-10 py-5 rounded-2xl font-display font-bold text-2xl uppercase tracking-[0.2em] flex items-center justify-center gap-4 transition-all relative overflow-hidden",
                isTranscribing
                  ? "bg-teal-800 text-current opacity-60 cursor-not-allowed"
                  : "bg-spiritual-accent text-black hover:scale-[1.01] active:scale-[0.99] shadow-xl"
              )}
            >
              {isTranscribing ? (
                <>
                  <div className="w-6 h-6 border-3 border-teal-600/20 border-t-spiritual-accent rounded-full animate-spin" />
                  Scribing Dharma...
                </>
              ) : (
                <>
                  <Sparkles className="w-7 h-7" />
                  {isNoiseReductionEnabled || isVolumeBoosted || isMusicIsolated ? "Scribe Purified Dharma" : "Begin Transcription"}
                </>
              )}
            </button>

            {/* Transcription Timer */}
            <AnimatePresence>
              {(isTranscribing || transcribeElapsedTime > 0) && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className={cn(
                    "mt-4 flex items-center justify-center gap-6 px-6 py-3 rounded-xl border transition-colors",
                    transcribeComplete
                      ? "bg-teal-900/40 border-teal-600/30"
                      : "bg-teal-800/60 border-spiritual-border/40"
                  )}
                >
                  {/* Status dot + label */}
                  <div className="flex items-center gap-2">
                    {transcribeComplete ? (
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                    ) : (
                      <span className="w-2 h-2 bg-spiritual-accent rounded-full animate-pulse" />
                    )}
                    <span className="text-xs font-mono uppercase tracking-widest opacity-60">
                      {transcribeComplete ? 'Completed In' : 'Elapsed'}
                    </span>
                    <span className={cn(
                      "text-sm font-mono font-bold tabular-nums",
                      transcribeComplete ? "text-green-400" : "text-spiritual-accent"
                    )}>
                      {String(Math.floor(transcribeElapsedTime / 60)).padStart(2, '0')}:{String(transcribeElapsedTime % 60).padStart(2, '0')}
                    </span>
                  </div>

                  {estimatedTranscribeTime !== null && (
                    <>
                      <span className="opacity-20 text-xs">|</span>
                      {!transcribeComplete && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono uppercase tracking-widest opacity-60">Est. Total</span>
                          <span className="text-sm font-mono font-bold opacity-80 tabular-nums">
                            ~{String(Math.floor(estimatedTranscribeTime / 60)).padStart(2, '0')}:{String(estimatedTranscribeTime % 60).padStart(2, '0')}
                          </span>
                        </div>
                      )}
                      <div className="flex-1 max-w-[140px] h-1.5 bg-teal-700 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-1000",
                            transcribeComplete ? "bg-green-400" : "bg-spiritual-accent"
                          )}
                          style={{
                            width: transcribeComplete
                              ? '100%'
                              : `${Math.min(98, (transcribeElapsedTime / estimatedTranscribeTime) * 100)}%`
                          }}
                        />
                      </div>
                      {transcribeComplete && (
                        <span className="text-xs font-mono text-green-400 opacity-70 uppercase tracking-widest">100%</span>
                      )}
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* Player & Editor Section */}
        {(audioFile || transcript) && (
          <div className="flex flex-col gap-10">
            <div className="w-full space-y-10">
              {/* Active Segment Preview */}
              <AnimatePresence>
                {isPlaying && activeSegmentIndex !== null && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="spiritual-card p-6 border-l-4 border-spiritual-accent bg-teal-800"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[12px] font-mono uppercase tracking-widest text-spiritual-accent">Active Dharma Segment</span>
                      <div className="flex gap-1">
                        <span className="w-1 h-1 bg-spiritual-accent rounded-full animate-pulse" />
                        <span className="w-1 h-1 bg-spiritual-accent rounded-full animate-pulse delay-75" />
                        <span className="w-1 h-1 bg-spiritual-accent rounded-full animate-pulse delay-150" />
                      </div>
                    </div>
                    <p className="text-xl font-display font-bold text-teal-900 dark:text-teal-100 leading-relaxed">
                      {segments[activeSegmentIndex].text}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Playback Monitor */}
              {audioFile && (
                <div className="spiritual-card p-6 mb-8 overflow-hidden relative group">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-spiritual-accent/10 rounded-lg">
                        <Activity className="w-5 h-5 text-spiritual-accent" />
                      </div>
                      <div>
                        <h3 className="text-sm font-mono font-bold uppercase tracking-widest text-spiritual-accent">Playback Monitor</h3>
                        <p className="text-[12px] text-current opacity-60 font-mono uppercase tracking-tighter">Real-time Spectral Analysis // Drag to Select</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[12px] font-mono font-bold text-current opacity-80 bg-teal-800 px-3 py-1.5 rounded-full border border-teal-900/10">
                      <span className="text-spiritual-accent">{formatTime(currentTime)}</span>
                      <span className="opacity-30">/</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

                  <div className="relative h-20 bg-teal-800 rounded-xl border border-teal-900/10 overflow-hidden group-hover:border-spiritual-accent/20 transition-all">
                    <div ref={waveformRef} className="w-full h-full" />

                    {/* Grid Overlay */}
                    <div className="absolute inset-0 pointer-events-none opacity-[0.03] overflow-hidden">
                      <div className="w-full h-full" style={{ backgroundImage: 'linear-gradient(#d4af37 1px, transparent 1px), linear-gradient(90deg, #d4af37 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <button
                        onClick={togglePlay}
                        className="w-10 h-10 flex items-center justify-center bg-spiritual-accent text-teal-950 rounded-full shadow-[0_0_15px_rgba(212,175,55,0.4)] hover:scale-105 transition-all active:scale-95"
                      >
                        {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                      </button>
                      <div className="flex flex-col">
                        <span className="text-[12px] font-mono font-bold uppercase tracking-widest text-current opacity-80">Status</span>
                        <span className={cn("text-xs font-mono font-bold uppercase tracking-widest", isPlaying ? "text-spiritual-accent" : "text-current opacity-60")}>
                          {isPlaying ? "Active Stream" : "Standby"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-3 bg-teal-800 p-1.5 rounded-lg border border-teal-900/10 mr-2">
                        <span className="text-[12px] font-mono font-bold uppercase tracking-widest text-current opacity-60 ml-1">Zoom</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setZoom(prev => Math.max(0, prev - 10))}
                            className="p-1 hover:bg-teal-800 rounded transition-all text-current opacity-80 hover:text-teal-600"
                            title="Zoom Out"
                          >
                            <ZoomOut className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="range"
                            min="0"
                            max="200"
                            value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="w-16 accent-spiritual-accent h-1.5"
                          />
                          <button
                            onClick={() => setZoom(prev => Math.min(200, prev + 10))}
                            className="p-1 hover:bg-teal-800 rounded transition-all text-current opacity-80 hover:text-teal-600"
                            title="Zoom In"
                          >
                            <ZoomIn className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <AnimatePresence>
                        {selectedRegion && (
                          <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="flex items-center gap-2 bg-spiritual-accent/10 p-1 rounded-xl border border-spiritual-accent/20 mr-2"
                          >
                            <button
                              onClick={handleRefine}
                              disabled={isRefining}
                              className="p-2 hover:bg-spiritual-accent/20 rounded-lg transition-all text-spiritual-accent flex items-center gap-2 group"
                              title="Refine Selection"
                            >
                              {isRefining ? (
                                <div className="w-4 h-4 border-2 border-spiritual-accent border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <Wand2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                              )}
                              <span className="text-[12px] font-mono font-bold uppercase tracking-widest hidden md:inline">Refine</span>
                            </button>
                            <div className="w-px h-4 bg-spiritual-accent/20" />
                            <button
                              onClick={handleTrim}
                              disabled={isTrimming}
                              className="p-2 hover:bg-red-900/20 rounded-lg transition-all text-red-600 flex items-center gap-2 group"
                              title="Cut Selection"
                            >
                              {isTrimming ? (
                                <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <Scissors className="w-4 h-4 group-hover:scale-110 transition-transform" />
                              )}
                              <span className="text-[12px] font-mono font-bold uppercase tracking-widest hidden md:inline">Cut</span>
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <button
                        onClick={handleDownloadAudio}
                        className="p-2 bg-teal-800 border border-teal-900/10 rounded-lg transition-all text-current opacity-80 hover:text-spiritual-accent mr-1"
                        title="Download Audio"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { if (wavesurferRef.current) wavesurferRef.current.setTime(0); }}
                        className="p-2 bg-teal-800 border border-teal-900/10 rounded-lg transition-all text-current opacity-80 hover:text-teal-600"
                        title="Reset Playback"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <div className="w-px h-8 bg-teal-800 mx-2" />
                      <div className="flex flex-col items-end">
                        <span className="text-[12px] font-mono font-bold uppercase tracking-widest text-current opacity-80">Bitrate</span>
                        <span className="text-xs font-mono font-bold text-spiritual-accent">320 KBPS</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Audio Player (Hidden for processing) */}
              <audio
                ref={audioRef}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                className="hidden"
              />

              {/* Editor */}
              <div className="spiritual-card flex flex-col">
                {/* Toolbar */}
                <div className="px-6 py-4 border-b border-spiritual-border flex flex-wrap items-center gap-4 bg-teal-800">
                  <div className="flex items-center gap-1 pr-4 border-r border-spiritual-border">
                    <button onClick={() => execCommand('bold')} className="p-2 hover:bg-teal-800 rounded-lg transition-all text-current opacity-80 hover:text-spiritual-accent"><Bold className="w-5 h-5" /></button>
                    <button onClick={() => execCommand('italic')} className="p-2 hover:bg-teal-800 rounded-lg transition-all text-current opacity-80 hover:text-spiritual-accent"><Italic className="w-5 h-5" /></button>
                    <button onClick={() => execCommand('underline')} className="p-2 hover:bg-teal-800 rounded-lg transition-all text-current opacity-80 hover:text-spiritual-accent"><Underline className="w-5 h-5" /></button>
                  </div>
                  <div className="flex items-center gap-1 pr-4 border-r border-spiritual-border">
                    <button onClick={() => execCommand('undo')} className="p-2 hover:bg-teal-800 rounded-lg transition-all text-current opacity-80 hover:text-spiritual-accent"><Undo className="w-5 h-5" /></button>
                    <button onClick={() => execCommand('redo')} className="p-2 hover:bg-teal-800 rounded-lg transition-all text-current opacity-80 hover:text-spiritual-accent"><Redo className="w-5 h-5" /></button>
                  </div>
                  <button
                    onClick={toggleListening}
                    className={cn(
                      "px-4 py-2 rounded-lg transition-all flex items-center gap-3 border",
                      isListening
                        ? "bg-red-900/20 border-red-500 text-red-500 animate-pulse"
                        : "bg-teal-800 border-teal-900/10 text-current opacity-80 hover:border-teal-900/20"
                    )}
                    title="Voice Typing (Sinhala)"
                  >
                    <div className={cn("w-2 h-2 rounded-full", isListening ? "bg-red-500 animate-ping" : "bg-red-500")} />
                    <span className="text-xs font-mono font-bold uppercase tracking-widest">{isListening ? "Listening..." : "Voice Input"}</span>
                  </button>
                  <button
                    onClick={handleShare}
                    disabled={isSharing || !transcript}
                    className={cn(
                      "px-4 py-2 rounded-lg transition-all flex items-center gap-3 border",
                      isSharing
                        ? "bg-spiritual-accent/20 border-spiritual-accent text-spiritual-accent"
                        : "bg-teal-800 border-teal-900/10 text-current opacity-80 hover:border-teal-900/20"
                    )}
                    title="Create Public Share Link"
                  >
                    <LinkIcon className={cn("w-4 h-4", isSharing && "animate-spin")} />
                    <span className="text-xs font-mono font-bold uppercase tracking-widest">{isSharing ? "Sharing..." : "Share Link"}</span>
                  </button>
                  <button
                    onClick={() => { if (editorRef.current) editorRef.current.innerHTML = ''; setTranscript(''); }}
                    className="ml-auto flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold uppercase tracking-widest text-red-500/60 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                    Purge Data
                  </button>
                </div>

                {/* Legend */}
                {segments.some(s => s.type && s.type !== 'normal') && (
                  <div className="px-6 py-2 border-b border-spiritual-border flex flex-wrap items-center gap-4 bg-teal-800">
                    <span className="text-[12px] font-mono font-bold uppercase tracking-widest text-current opacity-60">Detected:</span>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-400" />
                      <span className="text-[12px] font-mono font-bold uppercase tracking-widest text-blue-600/60">Names</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-400" />
                      <span className="text-[12px] font-mono font-bold uppercase tracking-widest text-green-600/60">Slang</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-400" />
                      <span className="text-[12px] font-mono font-bold uppercase tracking-widest text-red-600/60">Inappropriate</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-gray-400" />
                      <span className="text-[12px] font-mono font-bold uppercase tracking-widest text-gray-600/60">Silences</span>
                    </div>
                  </div>
                )}

                {shareUrl && (
                  <div className="px-6 py-3 bg-spiritual-accent/10 border-b border-spiritual-accent/20 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-4 h-4 text-spiritual-accent" />
                      <span className="text-xs font-mono font-bold text-spiritual-accent uppercase tracking-widest">Public Link Ready:</span>
                      <code className="text-[12px] bg-black/20 px-2 py-1 rounded text-teal-100/60">{shareUrl}</code>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(shareUrl);
                        alert('සබැඳිය පිටපත් කරන ලදී!');
                      }}
                      className="text-[12px] font-mono font-bold uppercase tracking-widest text-spiritual-accent hover:underline"
                    >
                      Copy Link
                    </button>
                  </div>
                )}

                {/* Content Area */}
                <div
                  ref={editorRef}
                  contentEditable={!isPlaying}
                  suppressContentEditableWarning
                  className="p-10 h-[calc(100vh-250px)] overflow-y-auto outline-none prose prose-invert max-w-none text-xl leading-relaxed font-display selection:bg-spiritual-accent/30"
                  onInput={(e) => {
                    const newText = e.currentTarget.innerText;
                    setTranscript(newText);
                    // If user edits manually, segments are no longer accurate
                    if (segments.length > 0) {
                      setSegments([]);
                    }
                  }}
                >
                  {/* Content will be managed by useEffect to avoid cursor reset */}
                </div>
              </div>

              {/* Briefing Window */}
              {(briefing || isGeneratingBriefing) && (
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="spiritual-card p-10 space-y-6 relative"
                >
                  <div className="absolute top-0 right-0 p-4 opacity-5">
                    <Sparkles className="w-24 h-24" />
                  </div>
                  <div className="flex items-center justify-between border-b border-spiritual-border pb-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-spiritual-secondary/10 rounded-xl flex items-center justify-center border border-spiritual-secondary/20">
                        <FileText className="text-spiritual-accent w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-display font-bold tracking-tight">Dharma Essence</h2>
                        <p className="text-[12px] font-mono uppercase tracking-widest text-spiritual-accent/60">AI Generated Summary</p>
                      </div>
                    </div>
                    {isGeneratingBriefing && (
                      <div className="flex items-center gap-3 px-4 py-2 bg-spiritual-accent/10 rounded-full border border-spiritual-accent/20">
                        <div className="w-3 h-3 border-2 border-spiritual-accent border-t-transparent rounded-full animate-spin" />
                        <span className="text-[12px] font-mono font-bold uppercase tracking-widest text-spiritual-accent">Contemplating...</span>
                      </div>
                    )}
                  </div>
                  <div className="prose prose-invert max-w-none text-lg leading-relaxed text-teal-100/60 font-display italic">
                    {briefing}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Actions Bottom Bar */}
            <aside className="w-full grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="spiritual-card p-8 lg:col-span-2 space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-1 h-4 bg-spiritual-accent rounded-full" />
                    <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-current opacity-80">Scribe Operations</h3>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="w-full flex items-center justify-between px-6 py-4 bg-teal-800 hover:bg-spiritual-accent hover:text-black rounded-xl transition-all group border border-teal-900/20 hover:border-spiritual-accent"
                  >
                    <div className="flex items-center gap-4">
                      <Copy className="w-5 h-5 opacity-70 group-hover:opacity-100" />
                      <span className="font-display font-bold uppercase tracking-widest text-sm">Copy to Clipboard</span>
                    </div>
                    <ExternalLink className="w-4 h-4 opacity-20 group-hover:opacity-100" />
                  </button>
                </div>

                <div className="pt-8 border-t border-spiritual-border">
                  <div className="flex items-center gap-2 mb-6">
                    <span className="w-1 h-4 bg-spiritual-secondary rounded-full" />
                    <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-current opacity-80">Preserve Dharma</h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                      onClick={() => handleExportGoogleDocs()}
                      disabled={isExporting}
                      className="w-full flex items-center justify-between px-6 py-4 bg-spiritual-secondary/10 text-spiritual-accent hover:bg-spiritual-accent hover:text-black rounded-xl transition-all group border border-spiritual-secondary/20 disabled:opacity-50"
                    >
                      <div className="flex items-center gap-4">
                        {isExporting ? <div className="w-5 h-5 border-2 border-spiritual-accent border-t-transparent rounded-full animate-spin" /> : <Cloud className="w-5 h-5" />}
                        <span className="font-display font-bold uppercase tracking-widest text-sm text-teal-100 group-hover:text-black">Google Docs</span>
                      </div>
                      <Download className="w-4 h-4 opacity-20 group-hover:opacity-100" />
                    </button>

                    <button
                      onClick={handleShare}
                      disabled={isSharing || !transcript}
                      className="w-full flex items-center justify-between px-6 py-4 bg-teal-800 hover:bg-teal-800 rounded-xl transition-all group border border-teal-900/20"
                    >
                      <div className="flex items-center gap-4">
                        <LinkIcon className={cn("w-5 h-5 text-spiritual-accent", isSharing && "animate-spin")} />
                        <span className="font-display font-bold uppercase tracking-widest text-sm">Public Link (Share)</span>
                      </div>
                      <ExternalLink className="w-4 h-4 opacity-20 group-hover:opacity-100" />
                    </button>

                    <button
                      onClick={handleExportTxt}
                      className="w-full flex items-center justify-between px-6 py-4 bg-teal-800 hover:bg-teal-800 rounded-xl transition-all group border border-teal-900/20"
                    >
                      <div className="flex items-center gap-4">
                        <FileText className="w-5 h-5 opacity-70" />
                        <span className="font-display font-bold uppercase tracking-widest text-sm">Text File (.txt)</span>
                      </div>
                      <Download className="w-4 h-4 opacity-20" />
                    </button>

                    <button
                      onClick={handleExportDocx}
                      className="w-full flex items-center justify-between px-6 py-4 bg-teal-800 hover:bg-teal-800 rounded-xl transition-all group border border-teal-900/20"
                    >
                      <div className="flex items-center gap-4">
                        <FileCode className="w-5 h-5 opacity-70" />
                        <span className="font-display font-bold uppercase tracking-widest text-sm">Word Doc (.docx)</span>
                      </div>
                      <Download className="w-4 h-4 opacity-20" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Status / Info */}
              <div className="spiritual-card p-8 bg-spiritual-accent/5 border-spiritual-accent/20">
                <div className="flex items-center gap-3 text-spiritual-accent mb-4">
                  <CheckCircle2 className="w-6 h-6" />
                  <span className="font-display font-bold uppercase tracking-widest text-sm">Zen Optimization</span>
                </div>
                <p className="text-sm font-sans text-current opacity-80 leading-relaxed">
                  The neural engine is currently harmonized for high-fidelity Dharma signal processing. Ensure source audio is clear for maximum synchronization.
                </p>
                <div className="mt-6 pt-6 border-t border-spiritual-accent/10 flex justify-between items-center">
                  <span className="text-[12px] font-mono uppercase tracking-widest opacity-70">Engine Harmony</span>
                  <span className="px-2 py-0.5 bg-spiritual-accent/20 text-spiritual-accent rounded text-[12px] font-mono font-bold">BALANCED</span>
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-spiritual-border text-center">
        <div className="flex flex-col items-center gap-4 opacity-30">
          <Leaf className="w-6 h-6" />
          <p className="text-[12px] font-mono uppercase tracking-[0.4em]">© 2026 MAHAGURU CENTER // DHARMA SCRIBE // MAY ALL BEINGS BE HAPPY</p>
        </div>
      </footer>
    </div>
  );
}



