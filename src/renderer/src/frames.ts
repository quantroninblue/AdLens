import type { Frames } from '../../shared/schema';

const wait = (target: HTMLVideoElement, event: string, ms = 20000) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => {cleanup(); reject(new Error('The video took too long to decode.'));}, ms);
  const ok = () => {cleanup(); resolve();};
  const fail = () => {cleanup(); reject(new Error('This video format could not be decoded for frame sampling.'));};
  const cleanup = () => {clearTimeout(timer); target.removeEventListener(event, ok); target.removeEventListener('error', fail);};
  target.addEventListener(event, ok, {once: true}); target.addEventListener('error', fail, {once: true});
});

// Samples evenly spaced frames (starting right at the hook) for the language model.
export async function sampleFrames(url: string, count = 12, maxSide = 768): Promise<Frames> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous'; video.muted = true; video.preload = 'auto'; video.src = url;
  try {
    await wait(video, 'loadedmetadata');
    let duration = video.duration;
    if (!Number.isFinite(duration)) {
      // Some WebM files report no duration until the end has been seen.
      video.currentTime = 1e7; await wait(video, 'seeked'); duration = video.duration;
    }
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('The video has no readable duration.');
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context || !video.videoWidth) throw new Error('The video has no visible picture.');
    const frames: Frames['frames'] = [];
    const n = Math.max(1, Math.min(count, Math.ceil(duration / 0.5)));
    for (let i = 0; i < n; i++) {
      const time = Math.min(duration - 0.05, 0.1 + i * (duration / n));
      video.currentTime = Math.max(0, time); await wait(video, 'seeked');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({time: Math.max(0, time), image: canvas.toDataURL('image/jpeg', 0.8)});
    }
    return {duration, width: video.videoWidth, height: video.videoHeight, frames};
  } finally {video.removeAttribute('src'); video.load();}
}
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
export const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export const formatSize = (bytes: number) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
