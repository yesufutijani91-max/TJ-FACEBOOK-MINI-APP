import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Group, Listing, PostView, SearchResults, User } from '../../shared/types';
import { Icon } from '../components/icons';
import { PostCard } from '../components/PostCard';
import { Avatar, EmptyState, Segmented, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { formatPrice } from '../lib/format';
import { useSession } from '../state/session';

type Tab = 'people' | 'posts' | 'groups' | 'marketplace';

const EMPTY: SearchResults = { users: [], posts: [], groups: [], listings: [] };

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const { toast } = useSession();
  const initial = params.get('q') ?? '';
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [tab, setTab] = useState<Tab>('people');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [trending, setTrending] = useState<{ posts: PostView[]; users: User[]; tags: string[] } | null>(null);

  const run = useCallback(
    async (term: string) => {
      if (term.trim().length === 0) {
        setResults(EMPTY);
        setSearched(false);
        return;
      }
      setLoading(true);
      try {
        const found = await api.search(term.trim());
        setResults(found);
        setSearched(true);
        setParams({ q: term.trim() }, { replace: true });
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Search failed', 'error');
      } finally {
        setLoading(false);
      }
    },
    [setParams, toast],
  );

  useEffect(() => {
    api
      .trending()
      .then(setTrending)
      .catch(() => setTrending({ posts: [], users: [], tags: [] }));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void run(query), 340);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const total = results.users.length + results.posts.length + results.groups.length + results.listings.length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-3 sm:px-4">
      <div className="card space-y-3 p-3">
        <div className="relative">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-soft" />
          <input
            className="input pl-8"
            placeholder="Search people, posts, groups and listings"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'people', label: `People${results.users.length ? ` · ${results.users.length}` : ''}` },
            { value: 'posts', label: `Posts${results.posts.length ? ` · ${results.posts.length}` : ''}` },
            { value: 'groups', label: `Groups${results.groups.length ? ` · ${results.groups.length}` : ''}` },
            { value: 'marketplace', label: `Market${results.listings.length ? ` · ${results.listings.length}` : ''}` },
          ]}
        />
      </div>

      {loading ? (
        <div className="card space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-2.5 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : !searched ? (
        <div className="space-y-3">
          {trending && trending.tags.length > 0 && (
            <div className="card p-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-strong">
                <Icon name="trend" size={16} /> Trending topics
              </h2>
              <div className="flex flex-wrap gap-2">
                {trending.tags.map((tag) => (
                  <button key={tag} className="chip" onClick={() => setQuery(tag)}>
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          )}
          {trending && trending.users.length > 0 && (
            <div className="card p-4">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-strong">
                <Icon name="sparkle" size={16} /> Recommended accounts
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {trending.users.slice(0, 6).map((person) => (
                  <Link key={person.id} to={`/u/${person.id}`} className="flex items-center gap-2.5 rounded-xl border border-subtle p-2 transition hover:shadow-sm">
                    <Avatar user={person} size={38} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-strong">{person.name}</p>
                      <p className="truncate text-xs text-soft">@{person.handle}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
          <EmptyState icon="search" title="Search TJ SOCIAL" description="Find people you know, conversations worth reading and things to buy." />
        </div>
      ) : total === 0 ? (
        <EmptyState icon="search" title="No results" description={`Nothing matched “${query.trim()}”. Try a different word or check the spelling.`} />
      ) : tab === 'people' ? (
        <PeopleList users={results.users} />
      ) : tab === 'posts' ? (
        results.posts.length === 0 ? (
          <EmptyState icon="edit" title="No posts matched" description="Try another search term." />
        ) : (
          <div className="space-y-3">
            {results.posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onChange={(next) => setResults((current) => ({ ...current, posts: current.posts.map((item) => (item.id === next.id ? next : item)) }))}
                onDeleted={(id) => setResults((current) => ({ ...current, posts: current.posts.filter((item) => item.id !== id) }))}
              />
            ))}
          </div>
        )
      ) : tab === 'groups' ? (
        <GroupList groups={results.groups} />
      ) : (
        <ListingList listings={results.listings} />
      )}
    </div>
  );
}

function PeopleList({ users }: { users: User[] }) {
  if (users.length === 0) return <EmptyState icon="users" title="No people matched" description="Try searching by name or username." />;
  return (
    <div className="card divide-y divide-[var(--border-subtle)]">
      {users.map((person) => (
        <Link key={person.id} to={`/u/${person.id}`} className="flex items-center gap-3 p-3 transition hover:bg-[var(--surface-muted)]">
          <Avatar user={person} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-strong">{person.name}</p>
            <p className="truncate text-xs text-soft">
              @{person.handle}
              {person.bio ? ` · ${person.bio}` : ''}
            </p>
          </div>
          <Icon name="arrow" size={16} className="text-soft" />
        </Link>
      ))}
    </div>
  );
}

function GroupList({ groups }: { groups: Group[] }) {
  if (groups.length === 0) return <EmptyState icon="group" title="No groups matched" description="Try a broader term." />;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups.map((group) => (
        <Link key={group.id} to={`/groups/${group.id}`} className="card overflow-hidden transition hover:shadow-md">
          <div className="h-20 bg-gradient-to-r from-brand-500 to-brand-800">
            {group.coverUrl && <img src={group.coverUrl} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="p-3">
            <p className="truncate text-sm font-bold text-strong">{group.name}</p>
            <p className="text-xs text-soft">{group.memberCount} members</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

function ListingList({ listings }: { listings: Listing[] }) {
  if (listings.length === 0) return <EmptyState icon="shop" title="No listings matched" description="Try another search term." />;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {listings.map((listing) => (
        <Link key={listing.id} to={`/marketplace?listing=${listing.id}`} className="card overflow-hidden transition hover:shadow-md">
          <div className="h-28 bg-[var(--surface-muted)]">
            {listing.images[0] ? (
              <img src={listing.images[0]} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-soft">
                <Icon name="image" size={22} />
              </div>
            )}
          </div>
          <div className="p-2.5">
            <p className="truncate text-sm font-semibold text-strong">{listing.title}</p>
            <p className="text-sm font-bold text-brand-600">{formatPrice(listing.priceCents, listing.currency)}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
