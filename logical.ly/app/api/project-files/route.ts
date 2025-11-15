import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const dataDir = join(process.cwd(), 'data');
const dataPath = join(dataDir, 'project-data.json');

async function readProjectData() {
  try {
    const content = await readFile(dataPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      title: '',
      projectDescription: '',
      technicalDomain: '',
      uploadedFiles: [],
    };
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { order, updates } = await request.json();

    if (typeof order !== 'number' || !updates || typeof updates !== 'object') {
      return NextResponse.json(
        { error: 'Invalid payload. Expected order and updates.' },
        { status: 400 },
      );
    }

    await mkdir(dataDir, { recursive: true });

    const data = await readProjectData();
    if (!Array.isArray(data.uploadedFiles)) {
      data.uploadedFiles = [];
    }

    const fileIndex = data.uploadedFiles.findIndex(
      (file: { order?: number }) => file?.order === order,
    );

    if (fileIndex === -1) {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }

    const sanitizedUpdates: Record<string, string> = {};
    if (typeof updates.fileName === 'string') {
      sanitizedUpdates.fileName = updates.fileName;
    }
    if (typeof updates.description === 'string') {
      sanitizedUpdates.description = updates.description;
    }
    if (typeof updates.content === 'string') {
      sanitizedUpdates.content = updates.content;
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update.' },
        { status: 400 },
      );
    }

    data.uploadedFiles[fileIndex] = {
      ...data.uploadedFiles[fileIndex],
      ...sanitizedUpdates,
    };

    await writeFile(dataPath, JSON.stringify(data, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      file: data.uploadedFiles[fileIndex],
    });
  } catch (error) {
    console.error('Failed to update project data:', error);
    return NextResponse.json(
      { error: 'Failed to update project data.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { fileName, fileType, description, content, order } = await request.json();

    if (typeof fileName !== 'string' || fileName.trim().length === 0) {
      return NextResponse.json(
        { error: 'File name is required.' },
        { status: 400 },
      );
    }

    await mkdir(dataDir, { recursive: true });
    const data = await readProjectData();

    if (!Array.isArray(data.uploadedFiles)) {
      data.uploadedFiles = [];
    }

    const currentMaxOrder = data.uploadedFiles.reduce(
      (max: number, file: { order?: number }) =>
        Math.max(max, typeof file?.order === 'number' ? file.order : 0),
      0,
    );

    const resolvedOrder =
      typeof order === 'number' && !Number.isNaN(order) ? order : currentMaxOrder + 1;

    const newFile = {
      fileName: fileName.trim(),
      fileType: typeof fileType === 'string' && fileType.length > 0 ? fileType : 'application/octet-stream',
      description: typeof description === 'string' ? description : '',
      content: typeof content === 'string' ? content : '',
      order: resolvedOrder,
    };

    data.uploadedFiles = data.uploadedFiles.filter(
      (file: { order?: number }) => file?.order !== resolvedOrder,
    );
    data.uploadedFiles.push(newFile);
    data.uploadedFiles.sort(
      (a: { order?: number }, b: { order?: number }) =>
        (a?.order ?? 0) - (b?.order ?? 0),
    );

    await writeFile(dataPath, JSON.stringify(data, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      file: newFile,
    });
  } catch (error) {
    console.error('Failed to add supporting document:', error);
    return NextResponse.json(
      { error: 'Failed to add supporting document.' },
      { status: 500 },
    );
  }
}

