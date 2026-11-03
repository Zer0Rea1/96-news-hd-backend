import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from '../src/app';
import { cleanArticle, postSlug, postSchema, slugText } from '../src/news-domain';

const owner = '11111111-1111-4111-8111-111111111111';
const label = '33333333-3333-4333-8333-333333333333';
const image = 'https://res.cloudinary.com/news/image/upload/v123/96news/posts/test.webp';
const post = { id: 'article-1', _id: 'article-1', slug: 'اردو-خبر-abc123', title: 'پاکستان میں تعلیم کی خبر', article: '<p>تفصیلات</p>', thumbnailImage: image, tags: [{ id: label, name: 'تعلیم', slug: 'تعلیم' }], version: 1, status: 'published', authorname: '96 نیوز ایچ ڈی' };
const input = { title: post.title, article: post.article, thumbnailImage: image, tags: [label], status: 'published' };
const calls: {name: string; args: Record<string, any>}[] = [];
let failure: unknown = null;
let missing = false;
const db = {
  auth: { getUser: async (token: string) => token === 'owner' ? { data: { user: { id: owner, email: 'owner@example.test', app_metadata: {} } } } : token === 'other-admin' ? { data: { user: { id: '22222222-2222-4222-8222-222222222222', app_metadata: { role: 'admin' }, user_metadata: { role: 'admin' } } } } : { data: { user: null }, error: new Error('invalid') } },
  rpc: async (name: string, args: Record<string, any>) => {
    calls.push({ name, args });
    return { error: failure, data: missing ? null : name === 'get_news' ? { posts: [post], totalCount: 1 } : name === 'get_news_tags' ? post.tags : post };
  },
} as unknown as SupabaseClient;
const server = createApp({ db, ownerId: owner, cloudName: 'news', upload: async () => image, uploadNews: async () => image }).listen(0,'127.0.0.1');
await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening',resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => server.close());
beforeEach(() => { calls.length=0; failure=null; missing=false; });
function request(path: string, token?: string, body?: unknown, method = body ? 'POST' : 'GET', headers = {}) {
  return fetch(origin+path,{ method, headers:{...headers,...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined });
}

describe('labels and Urdu slugs', () => {
  test('preserves Urdu, normalizes whitespace/punctuation, and disambiguates titles by ID', () => {
    expect(slugText('  پاکستان میں تعلیم، نئی پالیسی! ')).toBe('پاکستان-میں-تعلیم-نئی-پالیسی');
    expect(postSlug('اردو خبر', '123456789012345678901234')).toBe('اردو-خبر-345678901234');
    expect(postSlug('اردو خبر', '123456789012345678901234')).not.toBe(postSlug('اردو خبر','123456789012345678901235'));
    expect(Array.from(postSlug('خبر '.repeat(100),'123456789012345678901234')).length).toBeLessThanOrEqual(93);
    expect(postSlug('!!!','123456789012345678901234')).toStartWith('خبر-');
  });
  test('requires unique labels and refuses client-owned author, ID, slug and payment fields', () => {
    expect(postSchema.safeParse(input).success).toBe(true);
    for (const extra of [{authorid:owner},{slug:'bad'},{id:'bad'},{paid:true},{tags:[]},{tags:[label,label]}]) expect(postSchema.safeParse({...input,...extra}).success).toBe(false);
  });
  test('removes scripts, event handlers, styles and executable links from articles', () => {
    const cleaned = cleanArticle('<p style="position:fixed" onclick="bad()"><strong>خبر</strong><img src="https://example.com/a.jpg" onerror="bad()"><a href="javascript:bad()">لنک</a></p><script>bad()</script>');
    expect(cleaned).toContain('<strong>خبر</strong>');
    expect(cleaned).not.toMatch(/onclick|onerror|javascript:|<script|style=/);
  });

});

describe('unified news API', () => {
  test.each(['/api/admin/news/posts','/api/admin/news/tags','/api/admin/session','/api/admin/reporters'])('private %s rejects anonymous and a different administrator', async path => {
    expect((await request(path)).status).toBe(401);
    expect((await request(path,'other-admin')).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  test.each(['/api/auth/signup','/api/auth/login','/api/payment','/api/payment/verify','/api/newpost','/api/profile/users'])('removed endpoint %s stays unavailable',async path => {
    expect((await request(path,undefined,{},'POST')).status).toBe(404);
    expect(calls).toHaveLength(0);
  });
  test('read compatibility endpoints use server-side labels/counts and bounded pagination',async () => {
    const response = await request('/api/getpost?tag=pakistan&skip=12&limit=12');
    expect(response.status).toBe(200); expect((await response.json()).totalCount).toBe(1);
    expect(calls[0]!.args).toEqual({p_limit:12,p_skip:12,p_tag:'pakistan',p_query:null,p_include_drafts:false});
    expect((await request('/api/posts?limit=9999')).status).toBe(400);
    expect((await request('/api/posts?p_include_drafts=true')).status).toBe(400);
  });
  test('search input is passed as a value, without evaluating a user regex',async () => {
    expect((await request('/api/search?query='+encodeURIComponent('پاکستان % _ .*'))).status).toBe(200);
    expect(calls[0]!.args.p_query).toBe('پاکستان % _ .*');
  });
  test('both old IDs and Urdu slugs work; missing records return 404',async () => {
    expect((await request('/api/getpostbyid/article-1')).status).toBe(200);
    expect((await request('/api/posts/'+encodeURIComponent(post.slug))).status).toBe(200);
    missing=true; expect((await request('/api/posts/missing')).status).toBe(404);
  });
  test('owner creates sanitized posts and the server assigns identity and slug',async () => {
    const response=await request('/api/admin/news/posts','owner',{...input,article:'<p onclick="bad()">خبر</p>'});
    expect(response.status).toBe(201);
    const call=calls.find(call=>call.name==='mutate_news_post')!;
    expect(call.args.p_actor_id).toBe(owner); expect(call.args.p_input.article).not.toContain('onclick');
    expect(call.args.p_input.slug).toStartWith('پاکستان-میں-تعلیم-کی-خبر-');
    expect((await request('/api/admin/news/posts','owner',{...input,authorid:'spoofed'})).status).toBe(400);
    expect((await request('/api/admin/news/posts','owner',{...input,thumbnailImage:image.replace('/news/','/other/')})).status).toBe(400);
  });
  test('title edits preserve the slug and stale writes return a conflict',async () => {
    expect((await request('/api/admin/news/posts/article-1','owner',{...input,version:1,title:'نیا عنوان'},'PUT')).status).toBe(200);
    expect(calls.find(call=>call.name==='mutate_news_post')!.args.p_input).not.toHaveProperty('slug');
    failure={code:'40001',message:'private details'};
    const result=await request('/api/admin/news/posts/article-1','owner',{...input,version:1},'PUT');
    expect(result.status).toBe(409); expect(await result.text()).not.toContain('private details');
  });
  test('share HTML contains escaped metadata and a canonical slug without inline scripts',async () => {
    const response=await request('/post/article-1'); const body=await response.text();
    expect(response.status).toBe(200);expect(body).toContain('og:title');expect(body).toContain(encodeURIComponent(post.slug));expect(body).not.toContain('<script>');
  });
  test('missing database setup fails clearly without exposing database details', async () => {
    failure={code:'PGRST202',message:'private database details'};
    const response=await request('/api/posts');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private database details');
  });
  test('CORS permits the version header required for owner deletion', async () => {
    const response=await request('/api/admin/news/posts/article-1',undefined,undefined,'OPTIONS',{
      Origin:'https://admin.96newshd.com', 'Access-Control-Request-Method':'DELETE', 'Access-Control-Request-Headers':'authorization,if-match',
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('If-Match');
  });
  test('CORS accepts the profile website and rejects unknown origins',async () => {
    expect((await request('/api/posts',undefined,undefined,'GET',{Origin:'https://profile.96newshd.com'})).headers.get('access-control-allow-origin')).toBe('https://profile.96newshd.com');
    expect((await request('/api/posts',undefined,undefined,'GET',{Origin:'https://evil.example'})).status).toBe(403);
  });
});
