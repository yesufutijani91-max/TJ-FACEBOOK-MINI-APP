import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CommentView, Media, PostView } from '../../shared/types';
import { api } from '../lib/api';
import { formatCount, fullDate, timeAgo } from '../lib/format';
import { haptic } from '../lib/telegram';
import { useSession } from '../state/session';
import { Icon } from './icons';
import { Avatar, ConfirmDialog, Field, IconButton, LazyVideo, Modal, Spinner } from './ui';

function MediaGrid({ media }: { media: Media[] }) {
  if (!media.length) return null;
  if (media.length === 1) {
    const item = media[0];
    return (
      <div className="mt-3 overflow-hidden rounded-2xl border border-subtle bg-black/5">
        {item.type === 'video' ? (
          <LazyVideo src={item.url} className="max-h-[520px]" />
        ) : (
          <img src={item.url} alt="" className="max-h-[560px] w-full object-cover" loading="lazy" decoding="async" />
        )}
      </div>
    );
  }
  return (
    <div className={`mt-3 grid gap-1 overflow-hidden rounded-2xl border border-subtle ${media.length === 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
      {media.slice(0, 4).map((item, index) => (
        <div key={item.id} className={`relative bg-black/5 ${media.length === 3 && index === 0 ? 'col-span-2' : ''}`}>
          {item.type === 'video' ? (
            <LazyVideo src={item.url} className="h-40" />
          ) : (
            <img src={item.url} alt="" className="h-40 w-full object-cover sm:h-52" loading="lazy" decoding="async" />
          )}
        </div>
      ))}
    </div>
  );
}

function CommentRow({
  comment,
  postId,
  onRefresh,
  depth = 0,
}: {
  comment: CommentView;
  postId: string;
  onRefresh: () => void;
  depth?: number;
}) {
  const { user, toast } = useSession();
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);
  const mine = user?.id === comment.authorId;

  const submitReply = async () => {
    if (!replyText.trim()) return;
    setBusy(true);
    try {
      await api.addComment(postId, replyText.trim(), comment.id);
      setReplyText('');
      setReplying(false);
      onRefresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not reply', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteComment(comment.id);
      onRefresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not delete comment', 'error');
    }
  };

  return (
    <div className={`flex gap-2 ${depth > 0 ? 'ml-9' : ''}`}>
      <Link to={`/u/${comment.authorId}`}>
        <Avatar user={comment.author} size={depth > 0 ? 28 : 32} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-[var(--surface-muted)] px-3 py-2">
          <div className="flex items-center gap-2">
            <Link to={`/u/${comment.authorId}`} className="text-[0.82rem] font-semibold text-strong hover:underline">
              {comment.author.name}
            </Link>
            <span className="text-[0.68rem] text-soft">{timeAgo(comment.createdAt)}</span>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[0.9rem] leading-snug text-strong">{comment.content}</p>
        </div>
        <div className="mt-1 flex items-center gap-3 pl-1 text-[0.72rem] font-semibold text-soft">
          <button className="hover:text-brand-600" onClick={() => setReplying((value) => !value)}>
            Reply
          </button>
          {mine && (
            <button className="hover:text-[#b42318]" onClick={() => void remove()}>
              Delete
            </button>
          )}
        </div>
        {replying && (
          <div className="mt-2 flex items-center gap-2">
            <input
              className="input py-1.5 text-sm"
              placeholder={`Reply to ${comment.author.name.split(' ')[0]}…`}
              value={replyText}
              onChange={(event) => setReplyText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitReply();
              }}
              autoFocus
            />
            <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy || !replyText.trim()} onClick={() => void submitReply()}>
              {busy ? <Spinner size={14} /> : 'Send'}
            </button>
          </div>
        )}
        {comment.replies.length > 0 && (
          <div className="mt-2 space-y-2">
            {comment.replies.map((reply) => (
              <CommentRow key={reply.id} comment={reply} postId={postId} onRefresh={onRefresh} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentsSection({ post, onCountChange }: { post: PostView; onCountChange: (delta: number) => void }) {
  const { user, toast } = useSession();
  const [comments, setComments] = useState<CommentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { items } = await api.comments(post.id);
      setComments(items);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [post.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.addComment(post.id, text.trim());
      setText('');
      onCountChange(1);
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not comment', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-subtle pt-3">
      {loading ? (
        <div className="flex justify-center py-3 text-soft">
          <Spinner size={18} />
        </div>
      ) : comments.length === 0 ? (
        <p className="pb-2 text-center text-xs text-soft">No comments yet — start the conversation.</p>
      ) : (
        <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
          {comments.map((comment) => (
            <CommentRow key={comment.id} comment={comment} postId={post.id} onRefresh={load} />
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Avatar user={user} size={30} />
        <input
          className="input py-2 text-sm"
          placeholder="Write a comment…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button className="btn btn-primary px-3 py-2" disabled={busy || !text.trim()} onClick={() => void submit()} aria-label="Send comment">
          {busy ? <Spinner size={16} /> : <Icon name="send" size={16} />}
        </button>
      </div>
    </div>
  );
}

export function PostCard({
  post,
  onChange,
  onDeleted,
  defaultCommentsOpen = false,
}: {
  post: PostView;
  onChange: (post: PostView) => void;
  onDeleted: (id: string) => void;
  defaultCommentsOpen?: boolean;
}) {
  const { user, toast } = useSession();
  const [commentsOpen, setCommentsOpen] = useState(defaultCommentsOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.content);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('Spam or scam');
  const [reportDetails, setReportDetails] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const mine = user?.id === post.authorId;

  const like = async () => {
    haptic('light');
    onChange({ ...post, liked: !post.liked, likeCount: post.likeCount + (post.liked ? -1 : 1) });
    try {
      const result = await api.like(post.id);
      onChange({ ...post, liked: result.liked, likeCount: result.likeCount });
    } catch (error) {
      onChange(post);
      toast(error instanceof Error ? error.message : 'Could not like post', 'error');
    }
  };

  const toggleSave = async () => {
    setBusy('save');
    try {
      const result = await api.save(post.id);
      onChange({ ...post, saved: result.saved });
      toast(result.saved ? 'Saved to your collection' : 'Removed from saved', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save post', 'error');
    } finally {
      setBusy(null);
    }
  };

  const submitEdit = async () => {
    if (!editText.trim()) return;
    setBusy('edit');
    try {
      const { post: updated } = await api.updatePost(post.id, editText.trim());
      onChange({ ...post, ...updated });
      setEditing(false);
      toast('Post updated', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not update post', 'error');
    } finally {
      setBusy(null);
    }
  };

  const shareToFeed = async () => {
    setBusy('share');
    try {
      await api.share(post.id);
      setShareOpen(false);
      toast('Shared to your feed', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not share post', 'error');
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied', 'success');
    } catch {
      toast(url, 'info');
    }
    setShareOpen(false);
  };

  const submitReport = async () => {
    setBusy('report');
    try {
      const result = await api.report({
        targetType: 'post',
        targetId: post.id,
        reason: reportReason,
        details: reportDetails.trim() || undefined,
      });
      setReportOpen(false);
      setReportDetails('');
      toast(result.message, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not send report', 'error');
    } finally {
      setBusy(null);
    }
  };

  const deletePost = async () => {
    setConfirmDelete(false);
    try {
      await api.deletePost(post.id);
      onDeleted(post.id);
      toast('Post deleted', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not delete post', 'error');
    }
  };

  const meta = useMemo(() => fullDate(post.createdAt), [post.createdAt]);

  return (
    <article className="card animate-fade overflow-hidden px-4 py-3.5">
      <header className="flex items-start gap-3">
        <Link to={`/u/${post.authorId}`} className="shrink-0">
          <Avatar user={post.author} size={42} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link to={`/u/${post.authorId}`} className="truncate font-semibold text-strong hover:underline">
              {post.author.name}
            </Link>
            {post.author.isAdmin && <Icon name="shield" size={13} className="text-brand-600" />}
          </div>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-soft">
            <span title={meta}>{timeAgo(post.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <Icon name={post.visibility === 'public' ? 'globe' : 'lock'} size={12} />
            <span className="capitalize">{post.visibility}</span>
            {post.group && (
              <>
                <span aria-hidden="true">·</span>
                <Link to={`/g/${post.group.id}`} className="font-semibold text-brand-600 hover:underline">
                  {post.group.name}
                </Link>
              </>
            )}
            {post.updatedAt !== post.createdAt && <span className="text-[0.68rem]">(edited)</span>}
          </p>
        </div>
        <div className="relative">
          <IconButton icon="more" label="Post options" onClick={() => setMenuOpen((value) => !value)} />
          {menuOpen && (
            <>
              <button className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
              <div className="animate-pop absolute right-0 top-10 z-20 w-52 overflow-hidden rounded-xl border border-subtle bg-[var(--surface)] py-1 shadow-float">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-muted)]"
                  onClick={() => {
                    setMenuOpen(false);
                    void toggleSave();
                  }}
                  disabled={busy === 'save'}
                >
                  <Icon name="bookmark" size={16} filled={post.saved} /> {post.saved ? 'Unsave post' : 'Save post'}
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-muted)]"
                  onClick={() => {
                    setMenuOpen(false);
                    setShareOpen(true);
                  }}
                >
                  <Icon name="share" size={16} /> Share
                </button>
                {mine ? (
                  <>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-muted)]"
                      onClick={() => {
                        setMenuOpen(false);
                        setEditText(post.content);
                        setEditing(true);
                      }}
                    >
                      <Icon name="edit" size={16} /> Edit post
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#b42318] hover:bg-[var(--surface-muted)]"
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirmDelete(true);
                      }}
                    >
                      <Icon name="trash" size={16} /> Delete post
                    </button>
                  </>
                ) : (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#b42318] hover:bg-[var(--surface-muted)]"
                    onClick={() => {
                      setMenuOpen(false);
                      setReportOpen(true);
                    }}
                  >
                    <Icon name="shield" size={16} /> Report post
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {post.content && (
        <p className="mt-2.5 whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed text-strong">{post.content}</p>
      )}

      <MediaGrid media={post.media} />

      {post.sharedPost && (
        <Link to={`/post/${post.sharedPost.id}`} className="mt-3 block rounded-2xl border border-subtle p-3 hover:bg-[var(--surface-muted)]">
          <div className="flex items-center gap-2">
            <Avatar user={post.sharedPost.author} size={26} />
            <span className="text-sm font-semibold text-strong">{post.sharedPost.author.name}</span>
            <span className="text-xs text-soft">{timeAgo(post.sharedPost.createdAt)}</span>
          </div>
          {post.sharedPost.content && <p className="clamp-3 mt-1.5 text-sm text-strong">{post.sharedPost.content}</p>}
          {post.sharedPost.media[0] && post.sharedPost.media[0].type === 'image' && (
            <img src={post.sharedPost.media[0].url} alt="" className="mt-2 h-40 w-full rounded-xl object-cover" loading="lazy" />
          )}
        </Link>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-soft">
        <button className="flex items-center gap-1 hover:underline" onClick={() => setCommentsOpen(true)}>
          <span className="grid h-4 w-4 place-items-center rounded-full bg-brand-500 text-[0.55rem] text-white">
            <Icon name="heart" size={9} filled />
          </span>
          {formatCount(post.likeCount)}
        </button>
        <div className="flex items-center gap-3">
          <button className="hover:underline" onClick={() => setCommentsOpen((value) => !value)}>
            {formatCount(post.commentCount)} comments
          </button>
          <span>{formatCount(post.shareCount)} shares</span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1 border-t border-subtle pt-1">
        <button
          onClick={() => void like()}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition hover:bg-[var(--surface-muted)] ${
            post.liked ? 'text-brand-600' : 'text-soft'
          }`}
          aria-pressed={post.liked}
        >
          <Icon name="heart" size={18} filled={post.liked} /> Like
        </button>
        <button
          onClick={() => setCommentsOpen((value) => !value)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold text-soft transition hover:bg-[var(--surface-muted)]"
        >
          <Icon name="comment" size={18} /> Comment
        </button>
        <button
          onClick={() => setShareOpen(true)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold text-soft transition hover:bg-[var(--surface-muted)]"
        >
          <Icon name="share" size={18} /> Share
        </button>
        <button
          onClick={() => void toggleSave()}
          className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition hover:bg-[var(--surface-muted)] ${
            post.saved ? 'text-brand-600' : 'text-soft'
          }`}
          aria-label={post.saved ? 'Unsave' : 'Save'}
        >
          <Icon name="bookmark" size={18} filled={post.saved} />
        </button>
      </div>

      {commentsOpen && <CommentsSection post={post} onCountChange={(delta) => onChange({ ...post, commentCount: post.commentCount + delta })} />}

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit post">
        <textarea
          className="input min-h-[130px] resize-y"
          value={editText}
          onChange={(event) => setEditText(event.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-soft" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy === 'edit' || !editText.trim()} onClick={() => void submitEdit()}>
            {busy === 'edit' ? <Spinner size={16} /> : 'Save changes'}
          </button>
        </div>
      </Modal>

      <Modal open={shareOpen} onClose={() => setShareOpen(false)} title="Share post">
        <div className="space-y-2">
          <button className="btn btn-primary w-full" onClick={() => void shareToFeed()} disabled={busy === 'share'}>
            {busy === 'share' ? <Spinner size={16} /> : <Icon name="share" size={16} />} Share to my feed
          </button>
          <button className="btn btn-soft w-full" onClick={() => void copyLink()}>
            <Icon name="arrow" size={16} /> Copy link
          </button>
        </div>
      </Modal>

      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Report post">
        <div className="space-y-3">
          <Field label="Reason">
            <select className="input" value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
              {['Spam or scam', 'Harassment or hate', 'Nudity or violence', 'False information', 'Something else'].map((reason) => (
                <option key={reason}>{reason}</option>
              ))}
            </select>
          </Field>
          <Field label="Details (optional)">
            <textarea
              className="input min-h-[90px]"
              value={reportDetails}
              onChange={(event) => setReportDetails(event.target.value)}
              placeholder="Tell moderators what is wrong with this post"
            />
          </Field>
          <button className="btn btn-primary w-full" onClick={() => void submitReport()} disabled={busy === 'report'}>
            {busy === 'report' ? <Spinner size={16} /> : 'Submit report'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this post?"
        description="This removes the post, its media and comments for everyone."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={deletePost}
      />
    </article>
  );
}
