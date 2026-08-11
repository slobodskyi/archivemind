-- Atomic/idempotent upload completion (issue #194).
--
-- Proves the guarantees that mocks cannot: one transaction across assets,
-- files, project membership, the ingest job and the replay ledger; tenant and
-- role gates on the SECURITY DEFINER RPC; stable ordered replay; and rollback
-- after a deliberately late failure.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- ── fixtures ────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'upload-a@test.dev'),
  ('00000000-0000-4000-8000-0000000000b2', 'upload-b@test.dev'),
  ('00000000-0000-4000-8000-0000000000c3', 'upload-viewer@test.dev'),
  ('00000000-0000-4000-8000-0000000000d4', 'upload-editor@test.dev');
insert into public.profiles (id, display_name) values
  ('00000000-0000-4000-8000-0000000000a1', 'Upload A'),
  ('00000000-0000-4000-8000-0000000000b2', 'Upload B'),
  ('00000000-0000-4000-8000-0000000000c3', 'Upload Viewer'),
  ('00000000-0000-4000-8000-0000000000d4', 'Upload Editor');
insert into public.workspaces (id, name, created_by) values
  ('10000000-0000-4000-8000-00000000aaaa', 'Upload WS-A', '00000000-0000-4000-8000-0000000000a1'),
  ('10000000-0000-4000-8000-00000000bbbb', 'Upload WS-B', '00000000-0000-4000-8000-0000000000b2');
insert into public.memberships (workspace_id, user_id, role) values
  ('10000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a1', 'owner'),
  ('10000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000c3', 'viewer'),
  ('10000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000d4', 'editor'),
  ('10000000-0000-4000-8000-00000000bbbb', '00000000-0000-4000-8000-0000000000b2', 'owner');
insert into public.projects (id, workspace_id, name, created_by) values
  ('20000000-0000-4000-8000-00000000aaaa', '10000000-0000-4000-8000-00000000aaaa', 'Upload Project A', '00000000-0000-4000-8000-0000000000a1'),
  ('20000000-0000-4000-8000-00000000bbbb', '10000000-0000-4000-8000-00000000bbbb', 'Upload Project B', '00000000-0000-4000-8000-0000000000b2');

create temporary table upload_test_results (
  label text primary key,
  asset_ids uuid[] not null,
  job_id uuid not null
);
grant select, insert on table upload_test_results to authenticated;

select has_table('public', 'upload_completions', 'the private upload replay ledger exists');
select ok(
  has_function_privilege(
    'authenticated',
    'public.complete_upload_batch(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'authenticated callers can reach the guarded completion RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.complete_upload_batch(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'anon cannot execute upload completion'
);
select ok(
  not has_table_privilege('authenticated', 'public.upload_completions', 'SELECT'),
  'authenticated callers cannot read object keys from the replay ledger'
);

-- Make the ordering guarantee executable: the job insert must observe every
-- project link already present. The trigger is removed after the scoped call
-- so the later all-files/no-project case remains valid.
create function public.test_upload_links_before_job()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_missing integer;
begin
  if new.type = 'ingest' then
    select count(*) into v_missing
      from jsonb_array_elements_text(new.payload -> 'asset_ids') as requested(asset_id)
     where not exists (
       select 1
         from public.project_assets pa
        where pa.project_id = '20000000-0000-4000-8000-00000000aaaa'
          and pa.asset_id = requested.asset_id::uuid
     );
    if v_missing <> 0 then
      raise exception using message = 'project_links_missing_before_job';
    end if;
  end if;
  return new;
end;
$$;
create trigger test_upload_links_before_job_trg
  before insert on public.ai_jobs
  for each row execute function public.test_upload_links_before_job();

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$insert into upload_test_results (label, asset_ids, job_id)
      select 'first', asset_ids, job_id
        from public.complete_upload_batch(
          '10000000-0000-4000-8000-00000000aaaa',
          '20000000-0000-4000-8000-00000000aaaa',
          '30000000-0000-4000-8000-000000000001',
          '[{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/first.jpg","filename":"first.jpg","mime":"image/jpeg","byte_size":123},{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/second.txt","filename":"second.txt","mime":"text/plain","byte_size":456}]'::jsonb
        )$$,
  'an editor atomically completes a two-file project upload with links before its job'
);

reset role;
drop trigger test_upload_links_before_job_trg on public.ai_jobs;
drop function public.test_upload_links_before_job();

select is(
  (select cardinality(asset_ids) from upload_test_results where label = 'first'),
  2,
  'the RPC returns one ordered asset id per upload'
);
select is(
  (select count(*) from public.assets where workspace_id = '10000000-0000-4000-8000-00000000aaaa'),
  2::bigint,
  'the first completion creates exactly two assets'
);
select is(
  (select count(*) from public.files where workspace_id = '10000000-0000-4000-8000-00000000aaaa'),
  2::bigint,
  'the first completion creates exactly two files'
);
select is(
  (select count(*) from public.project_assets where project_id = '20000000-0000-4000-8000-00000000aaaa'),
  2::bigint,
  'both assets are linked into the project'
);
select is(
  (select count(*) from public.ai_jobs where workspace_id = '10000000-0000-4000-8000-00000000aaaa' and type = 'ingest'),
  1::bigint,
  'the completion creates exactly one queued ingest job'
);
select is(
  (
    select array_agg(f.r2_key order by requested.ordinality)
      from upload_test_results result
      cross join unnest(result.asset_ids) with ordinality as requested(asset_id, ordinality)
      join public.files f on f.asset_id = requested.asset_id
     where result.label = 'first'
  ),
  array[
    '10000000-0000-4000-8000-00000000aaaa/originals/first.jpg',
    '10000000-0000-4000-8000-00000000aaaa/originals/second.txt'
  ]::text[],
  'asset ids preserve the input R2-key order'
);
select is(
  (
    select array_agg(a.kind order by requested.ordinality)
      from upload_test_results result
      cross join unnest(result.asset_ids) with ordinality as requested(asset_id, ordinality)
      join public.assets a on a.id = requested.asset_id
     where result.label = 'first'
  ),
  array['photo', 'document']::public.asset_kind[],
  'database MIME classification matches the shared upload contract'
);

-- Exact replay returns the original mapping/job and creates nothing else.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$insert into upload_test_results (label, asset_ids, job_id)
      select 'replay', asset_ids, job_id
        from public.complete_upload_batch(
          '10000000-0000-4000-8000-00000000aaaa',
          '20000000-0000-4000-8000-00000000aaaa',
          '30000000-0000-4000-8000-000000000001',
          '[{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/first.jpg","filename":"first.jpg","mime":"image/jpeg","byte_size":123},{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/second.txt","filename":"second.txt","mime":"text/plain","byte_size":456}]'::jsonb
        )$$,
  'an exact replay succeeds after a hypothetically lost HTTP response'
);
select is(
  (select asset_ids from upload_test_results where label = 'replay'),
  (select asset_ids from upload_test_results where label = 'first'),
  'an exact replay returns the same asset ids'
);
select is(
  (select job_id from upload_test_results where label = 'replay'),
  (select job_id from upload_test_results where label = 'first'),
  'an exact replay returns the same job id'
);
reset role;
select is(
  array[
    (select count(*) from public.assets where workspace_id = '10000000-0000-4000-8000-00000000aaaa'),
    (select count(*) from public.files where workspace_id = '10000000-0000-4000-8000-00000000aaaa'),
    (select count(*) from public.project_assets where project_id = '20000000-0000-4000-8000-00000000aaaa'),
    (select count(*) from public.ai_jobs where workspace_id = '10000000-0000-4000-8000-00000000aaaa' and type = 'ingest'),
    (select count(*) from public.upload_completions where workspace_id = '10000000-0000-4000-8000-00000000aaaa')
  ],
  array[2, 2, 2, 1, 1]::bigint[],
  'replay leaves every persisted row count unchanged'
);

-- Same tenant/key with anything but the exact actor and payload is a conflict.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000aaaa',
      '20000000-0000-4000-8000-00000000aaaa',
      '30000000-0000-4000-8000-000000000001',
      '[{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/changed.jpg","filename":"changed.jpg","mime":"image/jpeg","byte_size":123}]'::jsonb
    )$$,
  '23505', 'upload_completion_conflict',
  'reusing a completion id with a different upload payload conflicts'
);
select throws_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000aaaa', null,
      '30000000-0000-4000-8000-000000000001',
      '[{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/first.jpg","filename":"first.jpg","mime":"image/jpeg","byte_size":123},{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/second.txt","filename":"second.txt","mime":"text/plain","byte_size":456}]'::jsonb
    )$$,
  '23505', 'upload_completion_conflict',
  'reusing a completion id with a different project conflicts'
);
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-0000000000d4","role":"authenticated"}';
select throws_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000aaaa',
      '20000000-0000-4000-8000-00000000aaaa',
      '30000000-0000-4000-8000-000000000001',
      '[{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/first.jpg","filename":"first.jpg","mime":"image/jpeg","byte_size":123},{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/second.txt","filename":"second.txt","mime":"text/plain","byte_size":456}]'::jsonb
    )$$,
  '23505', 'upload_completion_conflict',
  'another editor cannot replay somebody else''s completion id'
);

-- Tenant/role/input validation is repeated inside the RPC even though the
-- Next.js route also validates its public JSON body.
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select throws_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000aaaa', null,
      '30000000-0000-4000-8000-000000000010',
      '[{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/viewer.jpg","filename":"viewer.jpg","mime":"image/jpeg","byte_size":1}]'::jsonb
    )$$,
  '42501', 'upload_editor_required',
  'a viewer cannot complete uploads'
);

set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000aaaa',
      '20000000-0000-4000-8000-00000000bbbb',
      '30000000-0000-4000-8000-000000000011',
      '[{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/cross-project.jpg","filename":"cross-project.jpg","mime":"image/jpeg","byte_size":1}]'::jsonb
    )$$,
  'P0002', 'upload_project_not_found',
  'a project in another workspace is indistinguishable from a missing project'
);
select throws_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000aaaa', null,
      '30000000-0000-4000-8000-000000000012',
      '[{"r2_key":"10000000-0000-4000-8000-00000000bbbb/originals/foreign.jpg","filename":"foreign.jpg","mime":"image/jpeg","byte_size":1}]'::jsonb
    )$$,
  '22023', 'invalid_upload_completion',
  'an R2 key outside the workspace prefix is rejected'
);
select throws_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000aaaa', null,
      '30000000-0000-4000-8000-000000000013', '{}'::jsonb
    )$$,
  '22023', 'invalid_upload_completion',
  'a scalar top-level payload is rejected with the public validation code'
);
select throws_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000aaaa', null,
      '30000000-0000-4000-8000-000000000014', '[1]'::jsonb
    )$$,
  '22023', 'invalid_upload_completion',
  'a scalar array member is rejected with the public validation code'
);
select throws_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000aaaa', null,
      '30000000-0000-4000-8000-000000000015',
      '[{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/duplicate.jpg","filename":"a.jpg","mime":"image/jpeg","byte_size":1},{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/duplicate.jpg","filename":"b.jpg","mime":"image/jpeg","byte_size":1}]'::jsonb
    )$$,
  '22023', 'invalid_upload_completion',
  'duplicate R2 keys inside one completion are rejected'
);
select throws_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000aaaa', null,
      '30000000-0000-4000-8000-000000000016',
      (select jsonb_agg(jsonb_build_object(
        'r2_key', '10000000-0000-4000-8000-00000000aaaa/originals/' || n || '.jpg',
        'filename', n || '.jpg', 'mime', 'image/jpeg', 'byte_size', 1
      ) order by n) from generate_series(1, 101) as generated(n))
    )$$,
  '22023', 'invalid_upload_completion',
  'one atomic completion is capped at 100 files'
);
select throws_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000aaaa', null,
      '30000000-0000-4000-8000-000000000017',
      '[{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/too-large.jpg","filename":"too-large.jpg","mime":"image/jpeg","byte_size":104857601}]'::jsonb
    )$$,
  '22023', 'invalid_upload_completion',
  'a completion cannot exceed the single-PUT byte limit'
);

-- The same random UUID is independent in a different tenant because the
-- ledger key is composite (workspace_id, completion_id).
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select lives_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000bbbb', null,
      '30000000-0000-4000-8000-000000000001',
      '[{"r2_key":"10000000-0000-4000-8000-00000000bbbb/originals/tenant-b.jpg","filename":"tenant-b.jpg","mime":"image/jpeg","byte_size":1}]'::jsonb
    )$$,
  'the same completion UUID can be used independently in another workspace'
);
reset role;
select is(
  (select count(*) from public.upload_completions where completion_id = '30000000-0000-4000-8000-000000000001'),
  2::bigint,
  'the composite ledger contains one independent row per workspace'
);

-- Force a failure at the latest domain write. Since the ai_jobs trigger fires
-- after assets/files/links have been inserted, their absence proves the RPC is
-- one transaction rather than merely idempotent at the end.
create function public.test_fail_upload_job()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type = 'ingest' and exists (
    select 1
      from public.assets a
     where a.title = 'force-rollback.jpg'
       and a.id in (
         select asset_id::uuid
           from jsonb_array_elements_text(new.payload -> 'asset_ids') as requested(asset_id)
       )
  ) then
    raise exception using message = 'forced_upload_job_failure';
  end if;
  return new;
end;
$$;
create trigger test_fail_upload_job_trg
  before insert on public.ai_jobs
  for each row execute function public.test_fail_upload_job();

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$select * from public.complete_upload_batch(
      '10000000-0000-4000-8000-00000000aaaa',
      '20000000-0000-4000-8000-00000000aaaa',
      '30000000-0000-4000-8000-000000000099',
      '[{"r2_key":"10000000-0000-4000-8000-00000000aaaa/originals/force-rollback.jpg","filename":"force-rollback.jpg","mime":"image/jpeg","byte_size":99}]'::jsonb
    )$$,
  'P0001', 'forced_upload_job_failure',
  'a late job failure aborts the whole completion'
);
reset role;
drop trigger test_fail_upload_job_trg on public.ai_jobs;
drop function public.test_fail_upload_job();

select is(
  (select count(*) from public.assets where workspace_id = '10000000-0000-4000-8000-00000000aaaa'),
  2::bigint,
  'the late failure rolls back its asset'
);
select is(
  (select count(*) from public.files where workspace_id = '10000000-0000-4000-8000-00000000aaaa'),
  2::bigint,
  'the late failure rolls back its file'
);
select is(
  (select count(*) from public.project_assets where project_id = '20000000-0000-4000-8000-00000000aaaa'),
  2::bigint,
  'the late failure rolls back its project link'
);
select is(
  (select count(*) from public.ai_jobs where workspace_id = '10000000-0000-4000-8000-00000000aaaa' and type = 'ingest'),
  1::bigint,
  'the late failure leaves no queued job'
);
select is_empty(
  $$select 1 from public.upload_completions
     where workspace_id = '10000000-0000-4000-8000-00000000aaaa'
       and completion_id = '30000000-0000-4000-8000-000000000099'$$,
  'the late failure leaves no replay-ledger row'
);

select * from finish();
rollback;
