import { z } from 'zod';
import { validateUserConfigZodType, incompatibleFieldType, conditionalUnionType } from '@nomicfoundation/hardhat-zod-utils';
const schema=z.object({url:z.string(), unused:incompatibleFieldType('Unexpected field')});
const errors=validateUserConfigZodType({url:'https://example.invalid'},schema);
const path:Array<string|number>=errors[0]?.path??[];
const choice=conditionalUnionType([[(x:unknown)=>Array.isArray(x),z.array(z.string())]],'Expected strings');
choice.safeParse(['fictional']);
void path;

// @ts-expect-error A plain object is not a Zod schema.
validateUserConfigZodType({},{});
