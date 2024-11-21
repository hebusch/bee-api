/**
 * Copyright 2024 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import crypto from 'node:crypto';

import { Loaded, ref } from '@mikro-orm/core';
import dayjs from 'dayjs';

import { ArtifactCreateBody, ArtifactCreateResponse } from './dtos/artifact-create.js';
import type { Artifact as ArtifactDto } from './dtos/artifact.js';
import { Artifact, ArtifactType } from './entities/artifact.entity.js';
import { ArtifactReadParams, ArtifactReadResponse } from './dtos/artifact-read.js';
import {
  ArtifactUpdateBody,
  ArtifactUpdateParams,
  ArtifactUpdateResponse
} from './dtos/artifact-update.js';
import { ArtifactDeleteParams, ArtifactDeleteResponse } from './dtos/artifact-delete.js';
import { AppArtifact } from './entities/app-artifact.entity.js';
import {
  ArtifactSharedReadParams,
  ArtifactSharedReadQuery,
  ArtifactSharedReadResponse
} from './dtos/artifact-shared-read.js';
import { ArtifactsListQuery, ArtifactsListResponse } from './dtos/artifacts-list.js';
import { ArtifactShared } from './dtos/artifact-shared.js';

import { Thread } from '@/threads/thread.entity.js';
import { Message } from '@/messages/message.entity.js';
import { APIError, APIErrorCode } from '@/errors/error.entity.js';
import { createDeleteResponse } from '@/utils/delete.js';
import { getUpdatedValue } from '@/utils/update.js';
import { createPaginatedResponse, getListCursor } from '@/utils/pagination.js';
import { ORM } from '@/database.js';

export function toDto(artifact: Loaded<Artifact>): ArtifactDto {
  return {
    ...toSharedDto(artifact),
    object: 'artifact',
    thread_id: artifact.thread.id,
    message_id: artifact.message.id
  };
}

export function toSharedDto(artifact: Loaded<Artifact>): ArtifactShared {
  const dto = {
    id: artifact.id,
    object: 'artifact.shared' as const,
    type: artifact.type,
    metadata: artifact.metadata ?? {},
    created_at: dayjs(artifact.createdAt).unix(),
    source_code: (artifact as AppArtifact).sourceCode,
    share_url: artifact.accessSecret
      ? `/v1/artifacts/${artifact.id}/shared?secret=${artifact.accessSecret}`
      : '',
    name: artifact.name,
    description: artifact.description ?? ''
  };
  switch (artifact.type) {
    case ArtifactType.APP:
      return {
        ...dto,
        source_code: (artifact as AppArtifact).sourceCode
      };
  }
}

function getSecret() {
  return crypto.randomBytes(24).toString('base64url');
}

export async function createArtifact(body: ArtifactCreateBody): Promise<ArtifactCreateResponse> {
  const thread = await ORM.em.getRepository(Thread).findOneOrFail({ id: body.thread_id });
  const message = await ORM.em.getRepository(Message).findOneOrFail({ id: body.message_id });

  if (message.thread.id !== thread.id) {
    throw new APIError({ message: 'Thread message mismatch', code: APIErrorCode.INVALID_INPUT });
  }

  if (body.type === ArtifactType.APP) {
    const artifact = new AppArtifact({
      thread: ref(thread),
      message: ref(message),
      sourceCode: body.source_code,
      metadata: body.metadata,
      accessSecret: body.shared === true ? getSecret() : undefined,
      name: body.name,
      description: body.description
    });
    await ORM.em.persistAndFlush(artifact);
    return toDto(artifact);
  }
  throw new APIError({ message: 'Artifact type not supported', code: APIErrorCode.INVALID_INPUT });
}

export async function readArtifact({
  artifact_id
}: ArtifactReadParams): Promise<ArtifactReadResponse> {
  const artifact = await ORM.em.getRepository(Artifact).findOneOrFail({
    id: artifact_id
  });
  return toDto(artifact);
}

export async function readSharedArtifact({
  secret,
  artifact_id
}: ArtifactSharedReadParams & ArtifactSharedReadQuery): Promise<ArtifactSharedReadResponse> {
  const artifact = await ORM.em.getRepository(Artifact).findOneOrFail(
    {
      id: artifact_id,
      accessSecret: secret
    },
    { filters: { principalAccess: false } }
  );

  return toSharedDto(artifact);
}

export async function updateArtifact({
  artifact_id,
  metadata,
  name,
  description,
  shared
}: ArtifactUpdateParams & ArtifactUpdateBody): Promise<ArtifactUpdateResponse> {
  const artifact = await ORM.em.getRepository(Artifact).findOneOrFail({
    id: artifact_id
  });
  artifact.metadata = getUpdatedValue(metadata, artifact.metadata);
  artifact.name = getUpdatedValue(name, artifact.name);
  artifact.description = getUpdatedValue(description, artifact.description);
  if (shared === true) {
    artifact.accessSecret = getSecret();
  } else if (shared === false) {
    artifact.accessSecret = undefined;
  }
  await ORM.em.flush();
  return toDto(artifact);
}

export async function listArtifacts({
  limit,
  after,
  before,
  order,
  order_by
}: ArtifactsListQuery): Promise<ArtifactsListResponse> {
  const repo = ORM.em.getRepository(Artifact);
  const cursor = await getListCursor<Artifact>({}, { limit, order, order_by, after, before }, repo);
  return createPaginatedResponse(cursor, toDto);
}

export async function deleteArtifact({
  artifact_id
}: ArtifactDeleteParams): Promise<ArtifactDeleteResponse> {
  const artifact = await ORM.em.getRepository(Artifact).findOneOrFail({ id: artifact_id });

  artifact.delete();
  await ORM.em.flush();

  return createDeleteResponse(artifact_id, 'artifact');
}