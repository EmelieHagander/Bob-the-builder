-- FORM package 3: catalog definitions for the targeted CAD review.
-- INERT ON APPLY: role.cad-targeted-reviewer is published with enabled=false.
-- cad-assistant.ts and drawing-runtime.ts use the targeted path, and include it
-- in the CAD runtime identity, only when the pinned role is enabled. Applying
-- this changes no running review, request or paid retry. Enabling the role is a
-- separate owner-approved publication after the comparative acceptance in
-- Docs/bob-delivery-flow.md#form-next (package 5). The full Rita review stays
-- enforced until then. Keys avoid the cad-/cad. prefixes, so runtimes that
-- predate the gate also leave the CAD runtime identity unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $targeted_cad_review$
declare additions jsonb:=$targeted_cad_review_additions$
[
 {
  "key": "targeted-cad-review.persona",
  "kind": "prompt",
  "content": "Du är Rita, ritningsgranskaren vid Bobs ritbord, här i riktad granskning. Koden har redan jämfört versioner, källor och vyer och stoppat de fel den kan bevisa. Kvar till dig är det som kräver omdöme: konkreta frågor om exakt den här kandidaten, med originalunderlag och kodens resultat bredvid. Ditt ja ska gå att lita på, ditt nej ska gå att rätta, och det du inte kan avgöra lämnar du synligt."
 },
 {
  "key": "targeted-cad-review.contract",
  "kind": "instruction_fragment",
  "content": "You answer the targeted review of one exact construction-drawing candidate. Code has already checked versions, sources, requested views and the stored property checks it can prove. Those code findings are final for this candidate and are not yours to override.\n\nreview_packet lists every handoff requirement with its basis, source reference, required flag and any code evidence. Code evidence covers selected geometric properties only (functional_fidelity unverified): it is a lead, not proof that the requirement's meaning is met. Coverage tells you which evidence was current, missing or unreadable.\n\nAnswer every requirement against the ORIGINAL owner request, the handoff, the authorised independent evidence, the candidate geometry and the rendered views. met needs evidence you can point to in a view, a dimension or a source. unresolved means the available evidence cannot settle it; say what is missing. failed means the candidate contradicts it; give the precise correction. The candidate's title, description and Bob's confidence are not evidence.\n\nviews: are the requested views present and legible, and do they show each requirement where it is? reference: when reference images were opened, compare orientation, sides and context with them; not_applicable only when none were opened. Report other discrepancies, including requirements missing from the handoff, as issues.\n\nThis is the candidate stage: saving, linking and reopening come later. A requirement solely about those future actions is unresolved with evidence pending_delivery. You do not decide the verdict; code derives it from your answers."
 },
 {
  "key": "schema.bob_cad_targeted_review",
  "kind": "response_schema",
  "definition": {
   "type": "object",
   "additionalProperties": false,
   "properties": {
    "summary": {
     "type": "string",
     "minLength": 1,
     "maxLength": 2000
    },
    "requirements": {
     "type": "array",
     "maxItems": 24,
     "items": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
       "id": {
        "type": "string"
       },
       "status": {
        "type": "string",
        "enum": [
         "met",
         "unresolved",
         "failed"
        ]
       },
       "evidence": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2000
       },
       "correction": {
        "type": [
         "string",
         "null"
        ],
        "maxLength": 2000
       }
      },
      "required": [
       "id",
       "status",
       "evidence",
       "correction"
      ]
     }
    },
    "views": {
     "type": "object",
     "additionalProperties": false,
     "properties": {
      "status": {
       "type": "string",
       "enum": [
        "met",
        "unresolved",
        "failed"
       ]
      },
      "evidence": {
       "type": "string",
       "minLength": 1,
       "maxLength": 2000
      },
      "correction": {
       "type": [
        "string",
        "null"
       ],
       "maxLength": 2000
      }
     },
     "required": [
      "status",
      "evidence",
      "correction"
     ]
    },
    "reference": {
     "type": "object",
     "additionalProperties": false,
     "properties": {
      "status": {
       "type": "string",
       "enum": [
        "met",
        "unresolved",
        "failed",
        "not_applicable"
       ]
      },
      "evidence": {
       "type": "string",
       "minLength": 1,
       "maxLength": 2000
      },
      "correction": {
       "type": [
        "string",
        "null"
       ],
       "maxLength": 2000
      }
     },
     "required": [
      "status",
      "evidence",
      "correction"
     ]
    },
    "issues": {
     "type": "array",
     "maxItems": 20,
     "items": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
       "severity": {
        "type": "string",
        "enum": [
         "warning",
         "error"
        ]
       },
       "code": {
        "type": "string",
        "enum": [
         "orientation",
         "geometry",
         "views",
         "reference",
         "requirements",
         "readability",
         "uncertainty"
        ]
       },
       "correction": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2000
       }
      },
      "required": [
       "severity",
       "code",
       "correction"
      ]
     }
    }
   },
   "required": [
    "summary",
    "requirements",
    "views",
    "reference",
    "issues"
   ]
  },
  "metadata": {
   "dynamic_requirements": true
  }
 },
 {
  "key": "agent-contract.targeted-cad-review",
  "kind": "agent_contract",
  "definition": {
   "mode": "structured_read_only",
   "instructions_key": "targeted-cad-review.contract",
   "response_schema_key": "schema.bob_cad_targeted_review",
   "source_scope": "caller_authorized_project",
   "writes": "none",
   "review_authority": "answers concrete questions; code computes the candidate gate"
  }
 },
 {
  "key": "role.cad-targeted-reviewer",
  "kind": "role",
  "definition": {
   "name": "Rita",
   "title": "Riktad ritningsgranskning",
   "purpose": "Besvarar konkreta granskningsfrågor om den exakta kandidaten; koden räknar ut utslaget.",
   "function_name": "cad-reviewer",
   "module": "cad",
   "coworker_id": "bob",
   "enabled": false,
   "prompt_keys": [
    "targeted-cad-review.persona",
    "communication.concise",
    "targeted-cad-review.contract",
    "domain.vocabulary.cad",
    "cad-reviewer.requirement-keys",
    "specialist.tools"
   ],
   "profile_key": "profile.cad-reviewer",
   "routing_key": "routing.cad-reviewer",
   "contract_key": "agent-contract.targeted-cad-review",
   "method_keys": [
    "domain.vocabulary.cad"
   ],
   "tool_keys": [
    "tools.calculate_project",
    "tools.describe_tool"
   ],
   "response_schema_key": "schema.bob_cad_targeted_review"
  }
 }
]$targeted_cad_review_additions$::jsonb;
 patch jsonb; prompt_uuid uuid; version_uuid uuid; activation jsonb:='{}';
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 if not exists(select 1 from shared.ai_prompts where app='bob' and prompt_key='role.cad-reviewer') then raise exception 'cad_reviewer_role_missing'; end if;
 for patch in select value from jsonb_array_elements(additions) loop
  if exists(select 1 from shared.ai_prompts where app='bob' and prompt_key=patch->>'key') then raise exception 'targeted_cad_review_already_published: %',patch->>'key'; end if;
  insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
   values('bob',patch->>'key',patch->>'key','Targeted CAD review v1 (inert)',coalesce(patch->>'content',''),'',patch->>'kind') returning id into prompt_uuid;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prompt_uuid,1,patch->>'kind',1,jsonb_build_object('publication','targeted-cad-review-v1')||coalesce(patch->'metadata','{}'::jsonb),
    coalesce(patch->>'content',''),coalesce(patch->'definition','{}'::jsonb),'','[]'::jsonb) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 perform shared.activate_ai_catalog('bob',activation);
end $targeted_cad_review$;
commit;
