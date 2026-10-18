-- Deploy both Bob runtimes with the scoped-pointer consumer before activation.
-- The installed CLI aborts in native Bun; filename uses observed UTC.
-- Only two immutable catalog versions change. Pinned journals remain readable.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $memory_pointer_scope$
declare prior shared.ai_prompt_versions; next_version integer; version_id uuid;
 activation jsonb:='{}'; key text; body jsonb; metadata jsonb; content text;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 foreach key in array array['context-summary.contract','schema.bob_conversation_brief_v2'] loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=key and p.retired_at is null for update of p;
  if not found then raise exception 'memory_pointer_contract_missing'; end if;
  if prior.metadata->>'publication'='bob-memory-pointer-scope-v1' then raise exception 'memory_pointer_contract_already_active'; end if;
  body:=prior.definition; content:=prior.content;
  metadata:=(prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-memory-pointer-scope-v1');
  if key='schema.bob_conversation_brief_v2' then
   if body#>>'{properties,index,items,properties,seq,type}' is distinct from 'integer' then
    raise exception 'memory_pointer_schema_changed';
   end if;
   metadata:=metadata||jsonb_build_object('memory_pointer_scope_version',1);
  else
   content:=content||E'\n\n'||$memory_pointer_instructions$The server supplies availableSequences: the complete allowlist for index[].seq in this fold. Use only those values, including on repair. A pointer is optional; never invent one. The response schema enforces this exact list. currentRequest is relevance context only: it remains an original recent message and is NOT part of the older history being folded. Do not index it or claim that it has been folded. Keep the gist grounded in previousBrief and olderMessages. A recent request, later response or a sequence merely mentioned in source text does not become an eligible pointer.$memory_pointer_instructions$;
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,metadata,content,body,prior.flow,prior.available_variables)
   returning id into version_id;
  activation:=activation||jsonb_build_object(key,version_id);
 end loop;
 perform shared.activate_ai_catalog('bob',activation);
end $memory_pointer_scope$;
commit;
