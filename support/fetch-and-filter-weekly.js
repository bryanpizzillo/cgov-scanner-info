/**
 * @file This is a script that fetches the current json file from the digital.gov site scanning program.
 * This is meant to be used in some sort of CI/CD process prior to running the dev script, or
 * publishing the app. This should be able to be done in GH actions too, and could result
 * in a nice tool publishing out to github pages as part of a weekly build.
 */

import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

import got from 'got';
import { mkdirp } from 'mkdirp';
import { rimraf } from 'rimraf';


const DATA_URL = 'https://api.gsa.gov/technology/site-scanning/data/weekly-snapshot.json';

const fetchFileFromFile = async (dest) => {
	const data = await import(dest, {
		assert: { type: 'json' }
	});
	return data.default;
};

const downloadWeeklySnapshotFileFromWeb = async (dest) => {

	const downloadStream = got.stream(DATA_URL);
	const fileWriteStream = createWriteStream(dest);

	try {
		await pipeline(downloadStream, fileWriteStream);
		return;
	} catch (err) {
		console.log(err);
		process.exit(1);
	}
};

// Extract (final) www pages
const splitRecordsByFilter = (data, filterFn) => {
	const filteredRecords = data.reduce((ac, record) => {
		if (filterFn(record)) {
			return {
				...ac,
				filterMatches: [...ac.filterMatches, record],
			}
		} else {
			return {
				...ac,
				other: [...ac.other, record],
			}
		}
	}, {filterMatches: [], other: []});

	return filteredRecords;
};

/**
 * Helper function to extract out home page entries. This started out using a different check
 * for determining if it is a home page or not, which is why it says Unique. However, based
 * on the check we are doing now, we could *only* get unique.
 * @param {*} records
 * @returns
 */
const extractUniqueHomePageEntries = (records) => {
	// Some data points are associated with the target_url, so we can assume all these records
	// that are not a redirect, are a homepage.
	// Note: if the redirect is on the same domain, then target_url_redirects is null, but the
	// final URL can be a page on the site.
	// e.g., livehelp.cancer.gov has a final URL of https://livehelp.cancer.gov/app/chat/chat_launch
	const homeRecords = records
		.filter(record => !record.target_url_redirects)
	return homeRecords;
};

/**
 * Helper to get an average for a field across a set of records.
 *
 * @param {*} records the collection of records
 * @param {*} fieldName the name of the field that is being averaged
 * @param {*} transformFn a transformation function to temporarily add/modify fields on a record. For example, you can use this convert a string field to the number of characters in that string.
 * @returns
 */
const getFieldMean = (records, fieldName, transformFn) => {
	const sum = records.reduce((ac, record) => {
		const tmpRecord = transformFn(structuredClone(record));
		return ac + Number(tmpRecord[fieldName])
	}, 0);
	return sum/records.length;
}

/**
 * Helper to breakdown the averages for a field based on a field name
 * @param {string} fieldName the name of the field.
 * @param {Function} transformFn a function that takes in a record and is used to temporarily add/modify fields.
 * @param {Function} filterFn a function to filter records so you can remove entries where a value does not exist.
 * @returns
 */
const getMeanFn = (fieldName, transformFn = (rec) => rec, filterFn = () => true ) => (wwwHome, otherNCIHomeRecords, otherFedHomeRecords) => {
	return {
		www: getFieldMean(wwwHome.filter(filterFn), fieldName, transformFn),
		nci: getFieldMean(otherNCIHomeRecords.filter(filterFn), fieldName, transformFn),
		other: getFieldMean(otherFedHomeRecords.filter(filterFn), fieldName, transformFn),
	};
}

/**
 * Helper specifically for handling of require_links_url and required_links_text because we don't usually
 * care which one of the two data points matched.
 * @param {*} record
 * @param {*} urls
 * @param {*} text
 * @returns
 */
const hasRequiredLink = (record, urls = [], text = []) => {
	const hasUrl = (urls.length > 0 && record['required_links_url'] != null && record['required_links_url'].length > 0 && urls.reduce((ac, url) => ac || record['required_links_url'].includes(url), false));
	const hasText = (text.length > 0 && record['required_links_text'] != null && record['required_links_text'].length > 0 && text.reduce((ac, text) => ac || record['required_links_text'].includes(text), false));
	return hasUrl || hasText;
}

/**
 * Helper function to generate a report of average and % used counts.
 * Ignore the "home" in the record group names, this was in an inital version and I don't want to break something that is working.
 *
 * @param {*} wwwHomeRecords www.cancer.gov records
 * @param {*} otherNCIHomeRecords other nci, non-www records
 * @param {*} otherFedHomeRecords other non-nci, federal records.
 */
const generateReport = (wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords) => {
	const report = {
		'Performance - Cumulative Layout Shift (Average)': getMeanFn('cumulative_layout_shift')(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Performance - Cumulative Layout Shift (% Good)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: Number(rec['cumulative_layout_shift']) < 0.1})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Performance - Cumulative Layout Shift (% Needs improvement)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: Number(rec['cumulative_layout_shift']) >= 0.1 && Number(rec['cumulative_layout_shift']) < 0.25})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Performance - Cumulative Layout Shift (% Poor)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: Number(rec['cumulative_layout_shift']) >= 0.25})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'Performance - Largest Contentful Paint (Average)': getMeanFn('largest_contentful_paint')(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Performance - Largest Contentful Paint (% Good)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: Number(rec['largest_contentful_paint']) < 2500})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Performance - Largest Contentful Paint (% Needs improvement)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: Number(rec['largest_contentful_paint']) >= 2500 && Number(rec['largest_contentful_paint']) < 4000})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Performance - Largest Contentful Paint (% Poor)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: Number(rec['largest_contentful_paint']) >= 4000})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		// Third party domains here.
		'Third-party Service Domains (Average Count)': getMeanFn('third_party_service_count')(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Third-party Service Domains (% use 0 services)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: rec['third_party_service_count'] == 0})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Third-party Service Domains (% use 1-5 services)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: rec['third_party_service_count'] >= 1 && rec['third_party_service_count'] < 6})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Third-party Service Domains (% use 6-10 services)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: rec['third_party_service_count'] >= 6 && rec['third_party_service_count'] < 11})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Third-party Service Domains (% use 11-20 services)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: rec['third_party_service_count'] >= 11 && rec['third_party_service_count'] < 21})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Third-party Service Domains (% more than 20 services)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: rec['third_party_service_count'] >= 21})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'Sitemap.xml Detected (% having)': getMeanFn('sitemap_xml_detected')(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'SEO - title (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec,tmp_field: rec['title'] !== null && rec['title'].trim() !== ''})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		// Only average the lengths were the site has the field
		'SEO - title (Avg Length, where exists)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: (rec['title'] ?? '').length}),
			(rec) => rec['title'] !== null && rec['title'].trim() !== ''
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'SEO - description (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: rec['description'] !== null && rec['description'].trim() !== ''})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		// Only average the lengths were the site has the field
		'SEO - description (Avg Length, where exists)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: (rec['description'] ?? '').length}),
			(rec) => rec['description'] !== null && rec['description'].trim() !== ''
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'SEO - og:title (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec,tmp_field: rec['og_title'] !== null && rec['og_title'].trim() !== ''})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'SEO - og:description (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec,tmp_field: rec['og_description'] !== null && rec['og_description'].trim() !== ''})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'SEO - article:published_time (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec,tmp_field: rec['og_article_published'] !== null})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'SEO - article:modified_time (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec,tmp_field: rec['og_article_modified'] !== null})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'SEO - Canonical Link (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec,tmp_field: rec['canonical_link'] !== null && rec['canonical_link'].trim() !== ''})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'Robots.txt Detected (% having)': getMeanFn('robots_txt_detected')(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Mobile - Viewport Meta Tag Detected (% having)': getMeanFn('viewport_meta_tag')(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		// Required links come from https://github.com/GSA/site-scanning-engine/blob/main/libs/core-scanner/src/scans/required-links.ts
		// Some links have associated text and URLs the scanner is looking for, some only have text. Some links are actually multiple
		// checks. (especial spanish)
		'Required Links - About (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: hasRequiredLink(rec, ['about'], ['about us'])})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'Required Links - No Fear Act (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: hasRequiredLink(rec, ['fear'], ['no fear act'])})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'Required Links - FOIA (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: hasRequiredLink(rec, ['foia'], ['foia', 'freedom of information act'])})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'Required Links - Privacy Policy (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: hasRequiredLink(rec, ['privacy'], ['privacy policy'])})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'Required Links - USA.gov (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: hasRequiredLink(rec, ['usa.gov'], ['usa.gov'])})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'Required Links - Spanish (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: hasRequiredLink(rec, ['spanish', 'espanol', 'español', '/es'], ['espanol', 'español', 'espa&ntilde;ol', 'spanish'])})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'Required Links - Vulnerability Disclosure (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: hasRequiredLink(rec, [], ['vulnerability disclosure'])})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'Required Links - Budget and Performance (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: hasRequiredLink(rec, [], ['budget and performance'])})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'Required Links - Inspector General (% having)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec, tmp_field: hasRequiredLink(rec, ['inspector'], ['inspector general'])})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),


		'Infrastructure - Site Search Detected (% having)': getMeanFn('site_search')(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Infrastructure - DAP Detected (% having)': getMeanFn('dap')(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'Infrastructure - Search.gov Detected': getMeanFn('search_dot_gov')(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),
		'DNS - IPv6 (% having)': getMeanFn('ipv6')(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'USWDS - Count (% having non 0)': getMeanFn(
			'tmp_field',
			(rec) => ({...rec,tmp_field: Number(rec['uswds_count'] ?? 0) > 0})
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

		'USWDS - Count (avg)': getMeanFn(
			'uswds_count',
			(rec) => rec,
			(rec) => Number(rec['uswds_count'] ?? 0) > 0
		)(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords),

	};

	return report;
};

const main = async () => {

	// Setup folders.
	const workingPath = path.join(import.meta.dirname, '../working');
	const dest = path.join(workingPath, 'weekly-snapshot.json');
	// await rimraf(workingPath);
	// await mkdirp(workingPath);
	// await downloadWeeklySnapshotFileFromWeb(dest)

	const data = await fetchFileFromFile(dest);

	// 1. Fetch data and split the records into 3 buckets, www, all NCI, and all fed.
	const {filterMatches: wwwRecords, ...nonWWW} = splitRecordsByFilter(
		data,
		(record) => record.final_url_website === 'www.cancer.gov'
	);
	const {filterMatches: otherNCIRecords, ...nonNCI} = splitRecordsByFilter(
		nonWWW.other,
		(record) => record.final_url_website.match(/.*\.(cancer|ncifcrf|nci\.nih|smokefree)\.gov$/)
	);
	const otherFedRecords = nonNCI.other;
	delete(nonWWW.other);
	delete(nonNCI.other);

	console.log(`Total www.cancer.gov records: ${wwwRecords.length}`);
	console.log(`Total Other NCI records: ${otherNCIRecords.length}`);
	console.log(`Total Federal records: ${otherFedRecords.length}`);

	// 2. Find all the unique home page records.
	const wwwHomeRecords = extractUniqueHomePageEntries(wwwRecords);
  const otherNCIHomeRecords = extractUniqueHomePageEntries(otherNCIRecords);
	const otherFedHomeRecords = extractUniqueHomePageEntries(otherFedRecords);

	console.log(`Total www.cancer.gov home page records: ${wwwHomeRecords.length}`);
	console.log(`Total Other NCI home page records: ${otherNCIHomeRecords.length}`);
	console.log(`Total Federal home page records: ${otherFedHomeRecords.length}`);

	if (wwwHomeRecords.length !== 1) {
		console.error('ERROR: WWW has multiple home records!');
		process.exit(1);
	}

	// This is setting up the main report object that compares the www home page to other
	// nci and federal home pages.
	const homeReport = generateReport(wwwHomeRecords, otherNCIHomeRecords, otherFedHomeRecords);
	const homeReportPath = path.join(workingPath, 'homepage_report.csv');

	console.log();
	console.log('Metric, WWW Home, Other NCI Home Pages, Other Federal Web Pages');
	for(const key of Object.keys(homeReport)) {
		console.log(`"${key}", ${homeReport[key]['www']}, ${homeReport[key]['nci']}, ${homeReport[key]['other']}`);
	}
	console.log();

	// TODO: Generate a report across ALL pages. Technically we need to unique the list of pages.

	// Do an analysis of all NCI sites to determine how they use DAP
	const otherNCIdapParams = otherNCIHomeRecords.reduce((ac, record) => {
		const agency = record['dap_parameters'] && record['dap_parameters']['agency'] ? record['dap_parameters']['agency'] : '_NONE_';
		const subagency = record['dap_parameters'] && record['dap_parameters']['subagency'] ? record['dap_parameters']['subagency'] : '_NONE_';
		const key = `${agency}|${subagency}`;
		if (ac[key]) {
			const entry = ac[key];
			return {
				...ac,
				[key]: {
					...entry,
					count: entry.count + 1
				},
			};
		} else {
			return {
				...ac,
				[key]: {
					agency,
					subagency,
					count: 1,
				},
			};
		}
	}, []);

	console.log();
	console.log('Agency,Subagency,Count');
	for (const dapCombo of Object.values(otherNCIdapParams)) {
		console.log(`${dapCombo.agency}, ${dapCombo.subagency}, ${dapCombo.count}`)
	}
	console.log();

	// Do an analysis of all NCI site to see what third-party services are used.
	const otherNCIthirdPartyServices = otherNCIHomeRecords.reduce((ac, record) => {
		if (!record['third_party_service_domains']) {
			return ac;
		}

		return {
			...ac,
			...(record['third_party_service_domains'].reduce((domainac, domain) => {
				if (domainac[domain]) {
					return {
						...domainac,
						[domain]: domainac[domain] + 1,
					};
				} else {
					if (ac[domain]) {
						return {
							...domainac,
							[domain]: ac[domain] + 1,
						};
					} else {
						return {
							...domainac,
							[domain]: 1
						};
					}
				}
			}, {})),
		}
	}, {});

	console.log();
	console.log('Service Domain,Count');
	for (const [domain, count] of Object.entries(otherNCIthirdPartyServices)) {
		console.log(`${domain}, ${count}`);
	}
	console.log();

};

main();
