import { useRef, useState } from 'react';
import type { Group, MediaType, PostView, Privacy } from '../../shared/types';
import { api } from '../lib/api';
import { useSession } from '../state/session';
import { Icon } from './icons';
import { Avatar, IconButton, Spinner } from './ui';

const EMOJIS = ['😀', '😂', '🥰', '😍', '🔥', '👏', '🙌', '❤️', '💙', '🎉', '👍', '✨', '😮', '😢', '💯', '🚀'];

const VISIBILITY: { value: Privacy; label: string; icon: 'globe' | 'users' | 'lock' }[] = [
  { value: 'public', label: 'Public', icon: 'globe' },
  { value: 'friends', label: 'Friends', icon: 'users' },
  { value: 'private', label: 'Only me', icon: 'lock' },
];

interface Attachment {
  url: string;
  type: MediaType;
  name: string;
}

export function Composer({
  onCreated,
  group,
  sharedPost,
  placeholder = "What's on your mind?",
}: {
  onCreated: (post: PostView) => void;
  group?: Group | null;
  sharedPost?: PostView | null;
  placeholder?: string;
}) {
  const { user, toast, settings } = useSession();
  const [expanded, setExpanded] = useState(Boolean(sharedPost));
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<Privacy>(group ? 'public' : 'public');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const maxMb = settings?.maxUploadMb ?? 25;

  const pickFiles = () => fileRef.current?.click();

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setExpanded(true);
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 4 - attachments.length)) {
        if (file.size > maxMb * 1024 * 1024) {
          toast(`${file.name} is larger than ${maxMb} MB`, 'error');
          continue;
        }
        setProgress(0);
        const result = await api.upload(file, setProgress);
        setAttachments((current) => [...current, { url: result.url, type: result.type, name: file.name }]);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
      setProgress(0);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    if (!content.trim() && attachments.length === 0 && !sharedPost) return;
    setPosting(true);
    try {
      const { post } = await api.createPost({
        content: content.trim(),
        media: attachments.map((item) => ({ url: item.url, type: item.type })),
        visibility,
        groupId: group?.id ?? null,
        sharedPostId: sharedPost?.id ?? null,
      });
      onCreated(post);
      setContent('');
      setAttachments([]);
      setExpanded(false);
      setEmojiOpen(false);
      toast('Post published', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not publish post', 'error');
    } finally {
      setPosting(false);
    }
  };

  if (!user) return null;

  return (
    <section className="card px-4 py-3">
      <div className="flex items-center gap-2.5">
        <Avatar user={user} size={40} />
        <button
          className="flex-1 rounded-full bg-[var(--surface-muted)] px-4 py-2.5 text-left text-sm text-soft transition hover:bg-brand-50 dark:hover:bg-brand-500/10"
          onClick={() => setExpanded(true)}
        >
          {placeholder}
        </button>
        {!expanded && (
          <>
            <IconButton icon="image" label="Add photo" onClick={pickFiles} />
            <IconButton icon="video" label="Add video" onClick={pickFiles} />
          </>
        )}
      </div>

      {expanded && (
        <div className="animate-fade mt-3">
          <textarea
            className="input min-h-[96px] resize-y text-[0.95rem]"
            placeholder={placeholder}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            autoFocus
          />

          {sharedPost && (
            <div className="mt-2 rounded-xl border border-subtle p-2.5 text-sm">
              <p className="font-semibold text-strong">Sharing {sharedPost.author.name}'s post</p>
              <p className="clamp-2 text-soft">{sharedPost.content}</p>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {attachments.map((attachment, index) => (
                <div key={attachment.url} className="relative overflow-hidden rounded-xl border border-subtle">
                  {attachment.type === 'image' ? (
                    <img src={attachment.url} alt="" className="h-28 w-full object-cover" />
                  ) : (
                    <video src={attachment.url} className="h-28 w-full object-cover" muted playsInline />
                  )}
                  <button
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white"
                    aria-label="Remove attachment"
                    onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {uploading && (
            <div className="mt-2 flex items-center gap-2 text-xs text-soft">
              <Spinner size={14} /> Uploading {progress}%
            </div>
          )}

          {emojiOpen && (
            <div className="mt-2 grid grid-cols-8 gap-1 rounded-xl bg-[var(--surface-muted)] p-2">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  className="rounded-lg py-1 text-xl hover:bg-[var(--surface)]"
                  onClick={() => setContent((current) => current + emoji)}
                  aria-label={`Insert ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={pickFiles} disabled={uploading}>
              <Icon name="image" size={16} /> Photo
            </button>
            <button className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={pickFiles} disabled={uploading}>
              <Icon name="video" size={16} /> Video
            </button>
            <button className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setEmojiOpen((value) => !value)}>
              <Icon name="sparkle" size={16} /> Emoji
            </button>
            <select
              className="ml-auto rounded-lg bg-[var(--surface-muted)] px-2 py-1.5 text-xs font-semibold text-soft outline-none"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as Privacy)}
              aria-label="Post visibility"
            >
              {VISIBILITY.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button className="btn btn-primary px-3.5 py-1.5 text-xs" onClick={() => void submit()} disabled={posting || uploading || (!content.trim() && !attachments.length && !sharedPost)}>
              {posting ? <Spinner size={14} /> : 'Post'}
            </button>
            <button className="btn btn-ghost px-2 py-1.5 text-xs" onClick={() => { setExpanded(false); setEmojiOpen(false); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(event) => void onFiles(event.target.files)}
      />
    </section>
  );
}
