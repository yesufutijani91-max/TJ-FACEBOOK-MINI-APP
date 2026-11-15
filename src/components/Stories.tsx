import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Story, StoryGroup } from '../../shared/types';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { haptic } from '../lib/telegram';
import { useSession } from '../state/session';
import { Icon } from './icons';
import { Avatar, Field, IconButton, Modal, Spinner } from './ui';

const BACKGROUNDS = [
  'linear-gradient(135deg,#2f7bff,#154edb)',
  'linear-gradient(135deg,#ff8a00,#e52e71)',
  'linear-gradient(135deg,#00b09b,#96c93d)',
  'linear-gradient(135deg,#8e2de2,#4a00e0)',
  'linear-gradient(135deg,#0f2027,#2c5364)',
];

const REACTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];

function StoryComposer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { toast } = useSession();
  const [mode, setMode] = useState<'text' | 'media'>('text');
  const [caption, setCaption] = useState('');
  const [text, setText] = useState('');
  const [background, setBackground] = useState(BACKGROUNDS[0]);
  const [media, setMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.upload(file);
      setMedia({ url: result.url, type: result.type });
      setMode('media');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (mode === 'media' && !media) {
      toast('Choose a photo or video first', 'error');
      return;
    }
    if (mode === 'text' && !text.trim()) {
      toast('Write something for your story', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.createStory({
        mediaUrl: mode === 'media' ? media?.url : null,
        mediaType: mode === 'media' ? media?.type : null,
        caption: caption.trim(),
        background: mode === 'text' ? background : undefined,
      });
      setCaption('');
      setText('');
      setMedia(null);
      onCreated();
      onClose();
      toast('Story shared for 24 hours', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not create story', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create a story">
      <div className="space-y-3">
        <div className="flex gap-2">
          <button className={`btn flex-1 ${mode === 'text' ? 'btn-primary' : 'btn-soft'}`} onClick={() => setMode('text')}>
            <Icon name="edit" size={16} /> Text
          </button>
          <button className={`btn flex-1 ${mode === 'media' ? 'btn-primary' : 'btn-soft'}`} onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={16} /> Photo / video
          </button>
        </div>

        {mode === 'text' ? (
          <div
            className="grid min-h-[180px] place-items-center rounded-2xl p-4 text-center text-white"
            style={{ background }}
          >
            <textarea
              className="w-full resize-none bg-transparent text-center text-lg font-semibold text-white placeholder-white/70 outline-none"
              rows={4}
              placeholder="Type your story…"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
        ) : media ? (
          <div className="overflow-hidden rounded-2xl border border-subtle">
            {media.type === 'image' ? (
              <img src={media.url} alt="" className="max-h-64 w-full object-cover" />
            ) : (
              <video src={media.url} className="max-h-64 w-full" controls playsInline />
            )}
          </div>
        ) : (
          <button
            className="grid h-40 w-full place-items-center rounded-2xl border-2 border-dashed border-subtle text-soft"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Spinner /> : <Icon name="camera" size={26} />}
          </button>
        )}

        {mode === 'text' && (
          <div className="flex gap-2">
            {BACKGROUNDS.map((option) => (
              <button
                key={option}
                className={`h-8 flex-1 rounded-lg ring-2 ${background === option ? 'ring-brand-500' : 'ring-transparent'}`}
                style={{ background: option }}
                aria-label="Story background"
                onClick={() => setBackground(option)}
              />
            ))}
          </div>
        )}

        <Field label="Caption (optional)">
          <input className="input" value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Add a caption" maxLength={200} />
        </Field>

        <button className="btn btn-primary w-full" onClick={() => void submit()} disabled={busy || uploading}>
          {busy ? <Spinner size={16} /> : 'Share story'}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(event) => void upload(event.target.files?.[0])}
      />
    </Modal>
  );
}

function StoryViewer({
  groups,
  startIndex,
  onClose,
}: {
  groups: StoryGroup[];
  startIndex: number;
  onClose: () => void;
}) {
  const { user, toast } = useSession();
  const [groupIndex, setGroupIndex] = useState(startIndex);
  const [storyIndex, setStoryIndex] = useState(0);
  const [reply, setReply] = useState('');
  const [viewers, setViewers] = useState<{ user: { id: string; name: string; avatarUrl: string | null; handle: string }; createdAt: string }[] | null>(null);
  const [progress, setProgress] = useState(0);

  const group = groups[groupIndex];
  const story: Story | undefined = group?.stories[storyIndex];
  const isMine = group?.author.id === user?.id;

  const next = useCallback(() => {
    if (!group) return;
    if (storyIndex + 1 < group.stories.length) setStoryIndex((index) => index + 1);
    else if (groupIndex + 1 < groups.length) {
      setGroupIndex((index) => index + 1);
      setStoryIndex(0);
    } else onClose();
  }, [group, groupIndex, groups.length, storyIndex, onClose]);

  const prev = useCallback(() => {
    if (storyIndex > 0) setStoryIndex((index) => index - 1);
    else if (groupIndex > 0) {
      const previous = groups[groupIndex - 1];
      setGroupIndex((index) => index - 1);
      setStoryIndex(Math.max(0, previous.stories.length - 1));
    }
  }, [groupIndex, groups, storyIndex]);

  useEffect(() => {
    if (!story) return;
    setProgress(0);
    void api.viewStory(story.id).catch(() => undefined);
    const started = Date.now();
    const duration = 6000;
    const timer = setInterval(() => {
      const ratio = (Date.now() - started) / duration;
      setProgress(Math.min(1, ratio));
      if (ratio >= 1) {
        clearInterval(timer);
        next();
      }
    }, 60);
    return () => clearInterval(timer);
  }, [story, next]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') next();
      if (event.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  if (!group || !story) return null;

  const react = async (emoji: string) => {
    haptic('select');
    try {
      await api.reactStory(story.id, emoji);
      toast(`Reacted ${emoji}`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not react', 'error');
    }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    try {
      await api.replyStory(story.id, reply.trim());
      setReply('');
      toast('Reply sent', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not reply', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/95 text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex gap-1 px-3 pt-3">
          {group.stories.map((item, index) => (
            <span key={item.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
              <span
                className="block h-full bg-white transition-[width] duration-100"
                style={{ width: index < storyIndex ? '100%' : index === storyIndex ? `${progress * 100}%` : '0%' }}
              />
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 px-3 py-3">
          <Avatar user={group.author} size={34} ring />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{group.author.name}</p>
            <p className="text-[0.7rem] text-white/60">{timeAgo(story.createdAt)} · {story.viewCount} views</p>
          </div>
          <IconButton icon="close" label="Close stories" className="text-white hover:bg-white/15" onClick={onClose} />
        </div>

        <div className="relative flex-1 overflow-hidden" onClick={next}>
          {story.mediaUrl ? (
            story.mediaType === 'video' ? (
              <video src={story.mediaUrl} className="h-full w-full object-contain" autoPlay muted playsInline loop />
            ) : (
              <img src={story.mediaUrl} alt="" className="h-full w-full object-contain" />
            )
          ) : (
            <div className="grid h-full place-items-center p-6 text-center text-xl font-semibold" style={{ background: story.background ?? BACKGROUNDS[0] }}>
              {story.caption}
            </div>
          )}
          {story.mediaUrl && story.caption && (
            <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-center text-sm">{story.caption}</p>
          )}
          <button className="absolute left-0 top-0 h-full w-1/3" aria-label="Previous story" onClick={(event) => { event.stopPropagation(); prev(); }} />
          <button className="absolute right-0 top-0 h-2/3 w-1/3" aria-label="Next story" onClick={(event) => { event.stopPropagation(); next(); }} />
        </div>

        <div className="px-3 pb-4">
          <div className="mb-2 flex justify-center gap-1.5">
            {REACTIONS.map((emoji) => (
              <button key={emoji} className="rounded-full bg-white/10 px-2.5 py-1 text-lg hover:bg-white/20" onClick={() => void react(emoji)}>
                {emoji}
              </button>
            ))}
            {isMine && (
              <button
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
                onClick={async () => {
                  try {
                    const { items } = await api.storyViewers(story.id);
                    setViewers(items);
                  } catch {
                    toast('Could not load viewers', 'error');
                  }
                }}
              >
                <Icon name="eye" size={14} className="mr-1 inline" /> Viewers
              </button>
            )}
          </div>
          {!isMine && (
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm text-white placeholder-white/50 outline-none"
                placeholder={`Reply to ${group.author.name.split(' ')[0]}…`}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void sendReply();
                }}
              />
              <button className="grid h-9 w-9 place-items-center rounded-full bg-brand-500" onClick={() => void sendReply()} aria-label="Send reply">
                <Icon name="send" size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      <Modal open={Boolean(viewers)} onClose={() => setViewers(null)} title="Story viewers">
        {viewers && viewers.length === 0 && <p className="text-sm text-soft">No views yet.</p>}
        <ul className="space-y-2">
          {viewers?.map((entry) => (
            <li key={`${entry.user.id}-${entry.createdAt}`} className="flex items-center gap-2">
              <Avatar user={entry.user} size={32} />
              <span className="text-sm font-medium text-strong">{entry.user.name}</span>
              <span className="ml-auto text-xs text-soft">{timeAgo(entry.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

export function StoriesRail() {
  const { user } = useSession();
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { items } = await api.stories();
      setGroups(items);
    } catch {
      /* stories are optional */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const myGroup = useMemo(() => groups.find((group) => group.author.id === user?.id), [groups, user?.id]);

  return (
    <section className="card px-3 py-3">
      <div className="no-scrollbar flex gap-2.5 overflow-x-auto">
        <button className="w-[86px] shrink-0 text-center" onClick={() => setComposerOpen(true)}>
          <div className="relative mx-auto h-[112px] w-[86px] overflow-hidden rounded-2xl border border-subtle bg-[var(--surface-muted)]">
            {myGroup?.stories[0]?.mediaUrl ? (
              <img src={myGroup.stories[0].mediaUrl} alt="" className="h-full w-full object-cover opacity-90" />
            ) : (
              <div className="grid h-full place-items-center text-soft">
                <Avatar user={user} size={44} />
              </div>
            )}
            <span className="absolute bottom-1.5 left-1/2 grid h-7 w-7 -translate-x-1/2 place-items-center rounded-full border-2 border-white bg-brand-600 text-white">
              <Icon name="plus" size={15} strokeWidth={2.6} />
            </span>
          </div>
          <span className="mt-1 block truncate text-[0.7rem] font-semibold text-soft">Your story</span>
        </button>

        {loading
          ? Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="w-[86px] shrink-0">
                <div className="skeleton h-[112px] w-[86px] rounded-2xl" />
              </div>
            ))
          : groups
              .filter((group) => group.author.id !== user?.id)
              .map((group) => {
                const index = groups.indexOf(group);
                return (
                  <button key={group.author.id} className="w-[86px] shrink-0 text-center" onClick={() => setViewerIndex(index)}>
                    <div className={`mx-auto h-[112px] w-[86px] overflow-hidden rounded-2xl border-2 ${group.allViewed ? 'border-subtle' : 'border-brand-500'}`}>
                      {group.stories[0]?.mediaUrl ? (
                        <img src={group.stories[0].mediaUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="grid h-full place-items-center p-1 text-[0.65rem] font-semibold text-white" style={{ background: group.stories[0]?.background ?? BACKGROUNDS[0] }}>
                          {group.stories[0]?.caption?.slice(0, 40)}
                        </div>
                      )}
                    </div>
                    <span className="mt-1 block truncate text-[0.7rem] font-semibold text-soft">{group.author.name.split(' ')[0]}</span>
                  </button>
                );
              })}

        {!loading && groups.length <= 1 && (
          <div className="flex w-[86px] shrink-0 items-center justify-center rounded-2xl border border-dashed border-subtle px-2 text-center text-[0.65rem] text-soft">
            Stories from friends appear here
          </div>
        )}
      </div>

      <StoryComposer open={composerOpen} onClose={() => setComposerOpen(false)} onCreated={() => void load()} />
      {viewerIndex !== null && groups[viewerIndex] && (
        <StoryViewer
          groups={groups}
          startIndex={viewerIndex}
          onClose={() => {
            setViewerIndex(null);
            void load();
          }}
        />
      )}
    </section>
  );
}
