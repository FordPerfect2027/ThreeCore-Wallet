import { writeFile } from 'node:fs/promises';
import { proposalQuoteFixture } from '../../../test/helpers/proposal-quote-fixture.js';
import { prepareProposalQuoteReview } from '../../../src/proposal-quote-file.js';
const nowSeconds=Math.floor(Date.now()/1000),current=await proposalQuoteFixture({nowSeconds}),expired=await proposalQuoteFixture({nowSeconds:nowSeconds-1000});
for(const [name,value]of [['synthetic-proposal.json',current.files.proposalReviewFile],['synthetic-quote.json',current.files.quoteFile],['synthetic-expired-review.json',(await prepareProposalQuoteReview(expired.files,expired.options)).text]])await writeFile(new URL(name,import.meta.url),value,{flag:'wx'});
await writeFile(new URL('fixture-context.json',import.meta.url),JSON.stringify({synthetic:true,liveChainObservation:false,modelCalled:false,createdAtSeconds:nowSeconds,expiryAtSeconds:current.f.proposal.expiresAtSeconds},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({createdAtSeconds:nowSeconds,synthetic:true}));
