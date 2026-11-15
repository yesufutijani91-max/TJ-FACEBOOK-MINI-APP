import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Listing } from '../../shared/types';
import { Icon } from '../components/icons';
import { Avatar, EmptyState, Field, Modal, Segmented, Skeleton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatPrice, timeAgo } from '../lib/format';
import { useSession } from '../state/session';

const CATEGORIES = ['All', 'Electronics', 'Fashion', 'Home', 'Vehicles', 'Hobbies', 'Services', 'Other'];

function ListingCard({ listing, onOpen }: { listing: Listing; onOpen: () => void }) {
  return (
    <button className="card overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-lg" onClick={onOpen}>
      <div className="relative">
        {listing.images[0] ? (
          <img src={listing.images[0]} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid aspect-[4/3] w-full place-items-center bg-[var(--surface-muted)] text-soft">
            <Icon name="shop" size={28} />
          </div>
        )}
        {listing.status === 'sold' && (
          <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-white">Sold</span>
        )}
      </div>
      <div className="space-y-1 p-3">
        <p className="text-sm font-bold text-strong">{formatPrice(listing.priceCents, listing.currency)}</p>
        <p className="clamp-2 text-sm text-strong">{listing.title}</p>
        <p className="text-[0.7rem] text-soft">
          {listing.category} · {listing.location ?? 'No location'} · {timeAgo(listing.createdAt)}
        </p>
      </div>
    </button>
  );
}

export default function MarketplacePage() {
  const { toast } = useSession();
  const navigate = useNavigate();
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [listings, setListings] = useState<Listing[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Listing | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [form, setForm] = useState({ title: '', description: '', price: '', category: 'Electronics', location: '' });
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(
    async (nextCursor: string | null) => {
      if (nextCursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const page = await api.listings({
          q: query.trim() || undefined,
          category: category === 'All' ? undefined : category,
          cursor: nextCursor,
        });
        setListings((current) => (nextCursor ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not load listings', 'error');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [category, query, toast],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(null), 220);
    return () => clearTimeout(timer);
  }, [load]);

  const uploadImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 4)) {
        const result = await api.upload(file);
        setImages((current) => [...current, result.url].slice(0, 4));
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const price = Number.parseFloat(form.price.replace(',', '.'));
    if (!form.title.trim()) {
      toast('Add a title for your listing', 'error');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast('Enter a valid price', 'error');
      return;
    }
    setBusy(true);
    try {
      const { listing } = await api.createListing({
        title: form.title.trim(),
        description: form.description.trim(),
        priceCents: Math.round(price * 100),
        category: form.category,
        location: form.location.trim() || undefined,
        images,
      });
      setListings((current) => [listing, ...current]);
      setCreating(false);
      setForm({ title: '', description: '', price: '', category: 'Electronics', location: '' });
      setImages([]);
      toast('Listing published', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not publish listing', 'error');
    } finally {
      setBusy(false);
    }
  };

  const contactSeller = async (listing: Listing) => {
    try {
      const conversation = await api.openConversation(listing.sellerId);
      navigate(`/messages?c=${conversation.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not open chat', 'error');
    }
  };

  const toggleSold = async (listing: Listing) => {
    try {
      const { listing: updated } = await api.updateListing(listing.id, { status: listing.status === 'sold' ? 'active' : 'sold' });
      setListings((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSelected(updated);
      toast(updated.status === 'sold' ? 'Marked as sold' : 'Listing reactivated', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not update listing', 'error');
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-3 px-3 py-3 sm:px-4">
      <header className="card flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
          <Icon name="shop" size={20} />
        </span>
        <div className="mr-auto">
          <h1 className="text-base font-bold text-strong">Marketplace</h1>
          <p className="text-xs text-soft">Buy and sell with people in your community.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /> Sell something
        </button>
      </header>

      <div className="card space-y-3 p-3">
        <div className="relative">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-soft" />
          <input
            className="input pl-9"
            placeholder="Search marketplace"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {CATEGORIES.map((option) => (
            <button
              key={option}
              className={`chip shrink-0 ${category === option ? 'chip-active' : ''}`}
              onClick={() => setCategory(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="card overflow-hidden">
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : listings.length === 0 ? (
        <EmptyState
          icon="shop"
          title="No listings found"
          description="Try another category or be the first to post something for sale."
          action={
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              Create listing
            </button>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} onOpen={() => setSelected(listing)} />
            ))}
          </div>
          {cursor && (
            <div className="flex justify-center py-3">
              <button className="btn btn-soft" disabled={loadingMore} onClick={() => void load(cursor)}>
                {loadingMore ? <Spinner size={16} /> : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title ?? 'Listing'}>
        {selected && (
          <div className="space-y-3">
            {selected.images.length > 0 && (
              <div className="no-scrollbar flex gap-2 overflow-x-auto">
                {selected.images.map((url) => (
                  <img key={url} src={url} alt="" className="h-40 w-40 shrink-0 rounded-xl object-cover" />
                ))}
              </div>
            )}
            <p className="text-xl font-extrabold text-strong">{formatPrice(selected.priceCents, selected.currency)}</p>
            <p className="text-sm text-strong">{selected.title}</p>
            {selected.description && <p className="whitespace-pre-wrap text-sm text-soft">{selected.description}</p>}
            <p className="text-xs text-soft">
              {selected.category} · {selected.location ?? 'No location'} · {timeAgo(selected.createdAt)}
            </p>
            <div className="flex items-center gap-2 rounded-xl bg-[var(--surface-muted)] p-2.5">
              <Avatar user={selected.seller} size={36} />
              <div className="min-w-0">
                <Link to={`/u/${selected.sellerId}`} className="block truncate text-sm font-semibold text-strong">
                  {selected.seller.name}
                </Link>
                <p className="text-xs text-soft">Seller</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary flex-1" onClick={() => void contactSeller(selected)}>
                <Icon name="chat" size={16} /> Message seller
              </button>
              {selected.sellerId && (
                <button className="btn btn-soft" onClick={() => void toggleSold(selected)}>
                  {selected.status === 'sold' ? 'Mark available' : 'Mark sold'}
                </button>
              )}
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  try {
                    await api.report({ targetType: 'listing', targetId: selected.id, reason: 'inappropriate', details: '' });
                    toast('Report sent to moderators', 'success');
                  } catch (error) {
                    toast(error instanceof Error ? error.message : 'Could not report listing', 'error');
                  }
                }}
              >
                Report
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title="New listing">
        <div className="space-y-3">
          <div className="flex gap-2">
            {images.map((url) => (
              <div key={url} className="relative">
                <img src={url} alt="" className="h-20 w-20 rounded-xl object-cover" />
                <button
                  className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white"
                  onClick={() => setImages((current) => current.filter((item) => item !== url))}
                  aria-label="Remove image"
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
            {images.length < 4 && (
              <button
                className="grid h-20 w-20 place-items-center rounded-xl border-2 border-dashed border-subtle text-soft"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Spinner size={18} /> : <Icon name="camera" size={20} />}
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(event) => void uploadImages(event.target.files)} />

          <Field label="Title">
            <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="What are you selling?" maxLength={120} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (USD)">
              <input className="input" inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="0.00" />
            </Field>
            <Field label="Category">
              <select className="input" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                {CATEGORIES.filter((option) => option !== 'All').map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Location (optional)">
            <input className="input" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="City or neighbourhood" />
          </Field>
          <Field label="Description">
            <textarea
              className="input min-h-[96px]"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Condition, details, pickup options…"
              maxLength={2000}
            />
          </Field>
          <p className="text-[0.7rem] text-soft">Payments are arranged directly with the seller — TJ Social does not process payments.</p>
          <button className="btn btn-primary w-full" onClick={() => void submit()} disabled={busy || uploading}>
            {busy ? <Spinner size={16} /> : 'Publish listing'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
