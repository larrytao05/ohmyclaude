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
    const body = await request.json();
    const updates: Record<string, string> = {};

    if (typeof body.title === 'string') {
      updates.title = body.title;
    }
    if (typeof body.projectDescription === 'string') {
      updates.projectDescription = body.projectDescription;
    }
    if (typeof body.technicalDomain === 'string') {
      updates.technicalDomain = body.technicalDomain;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields provided.' },
        { status: 400 },
      );
    }

    await mkdir(dataDir, { recursive: true });
    const data = await readProjectData();

    const nextData = {
      ...data,
      ...updates,
    };

    await writeFile(dataPath, JSON.stringify(nextData, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      project: nextData,
    });
  } catch (error) {
    console.error('Failed to update project metadata:', error);
    return NextResponse.json(
      { error: 'Failed to update project metadata.' },
      { status: 500 },
    );
  }
}

