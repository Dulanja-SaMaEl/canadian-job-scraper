import re
import math
import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_caching import Cache

app = Flask(__name__)
CORS(app)

# Configure Cache (In-memory, 10-minute TTL)
app.config['CACHE_TYPE'] = 'SimpleCache'
app.config['CACHE_DEFAULT_TIMEOUT'] = 600
cache = Cache(app)

# Headers to prevent blocking
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
}

BASE_URL = "https://www.jobbank.gc.ca/jobsearch/jobsearch"
BASE_DOMAIN = "https://www.jobbank.gc.ca"

# Shared persistent session with connection pooling and retries
def create_session():
    s = requests.Session()
    retries = Retry(
        total=3,
        backoff_factor=0.3,
        status_forcelist=[500, 502, 503, 504],
        raise_on_status=False
    )
    adapter = HTTPAdapter(max_retries=retries, pool_connections=15, pool_maxsize=30)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    s.headers.update(HEADERS)
    return s

session = create_session()

def parse_job_article(article):
    """Parse a single job article tag into a dictionary safely with fallbacks."""
    try:
        # Job ID
        job_id = article.get("data-jobid", "")
        if not job_id and article.get("id"):
            job_id = article.get("id").replace("article-", "")

        link_elem = article.select_one("a.resultJobItem, a")
        url = link_elem["href"] if link_elem and link_elem.has_attr("href") else ""
        if url.startswith("/"):
            url = BASE_DOMAIN + url.split(';')[0]  # Remove session ids if any
        elif ";" in url:
            url = url.split(';')[0]

        if not job_id and url:
            match = re.search(r'/jobposting/(\d+)', url)
            if match:
                job_id = match.group(1)

        # Title
        title = "Unknown Title"
        title_tag = article.select_one(".noctitle, h3.title, h3")
        if title_tag:
            noctitle = title_tag.select_one(".noctitle")
            if noctitle:
                title = noctitle.get_text(strip=True)
            else:
                title_copy = BeautifulSoup(str(title_tag), "html.parser")
                for tag in title_copy.select(".flag, .job-source, .wb-inv"):
                    tag.decompose()
                title = title_copy.get_text(strip=True) or "Unknown Title"

        # Company
        company = "Unknown Company"
        company_elem = article.select_one(".business, .employer-name, .company")
        if company_elem:
            company = company_elem.get_text(strip=True)

        # Location
        location = "Unknown Location"
        location_elem = article.select_one(".location")
        if location_elem:
            loc_copy = BeautifulSoup(str(location_elem), "html.parser")
            for hidden in loc_copy.find_all("span", class_="wb-inv"):
                hidden.decompose()
            location = " ".join(loc_copy.get_text().split())

        # Salary
        salary = "Not listed"
        salary_elem = article.select_one(".salary, .pay")
        if salary_elem:
            sal_copy = BeautifulSoup(str(salary_elem), "html.parser")
            for hidden in sal_copy.find_all("span", class_="wb-inv"):
                hidden.decompose()
            salary = " ".join(sal_copy.get_text().split()).replace("Salary ", "").replace("Salary", "")

        # Date posted
        date_posted = "Unknown Date"
        date_elem = article.select_one(".date, .date-posted")
        if date_elem:
            date_posted = date_elem.get_text(strip=True)

        # Extract flags (like New, On site, Direct Apply)
        flags = []
        flag_container = article.select_one(".flag")
        if flag_container:
            for span in flag_container.find_all("span", recursive=False):
                span_copy = BeautifulSoup(str(span), "html.parser")
                for desc in span_copy.find_all("span", class_="description"):
                    desc.decompose()
                flag_text = span_copy.get_text(strip=True)
                if flag_text and flag_text not in flags:
                    flags.append(flag_text)

        # Also check for source badge (e.g. Job Bank)
        job_source = article.select_one(".job-source")
        if job_source:
            source_text = job_source.get_text(strip=True)
            if source_text and source_text not in flags and len(source_text) < 30:
                flags.append(source_text)

        # Extract official Canadian Job Bank number (e.g. 3681248) from li.source
        job_number = ""
        source_li = article.select_one("li.source")
        if source_li:
            m_jn = re.search(r'(?:Job number:?|#)\s*(\d+)', source_li.get_text())
            if not m_jn:
                m_jn = re.search(r'\b(\d{6,10})\b', source_li.get_text())
            if m_jn:
                job_number = m_jn.group(1)

        if not job_number:
            m_fallback = re.search(r'Job\s*Bank\s*(?:Job\s*number:?|#)?\s*(\d{6,10})', article.get_text(), re.I)
            if m_fallback:
                job_number = m_fallback.group(1)

        # Validate that this is actually a job item
        if not url and not job_id:
            return None
        if title == "Unknown Title" and company == "Unknown Company" and location == "Unknown Location":
            return None

        return {
            "jobId": job_id,
            "jobNumber": job_number or job_id,
            "title": title,
            "company": company,
            "location": location,
            "salary": salary,
            "datePosted": date_posted,
            "url": url,
            "flags": flags
        }
    except Exception as e:
        print(f"Error parsing article: {e}")
        return None

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "service": "canadian-job-scraper-api"})

@app.route('/api/jobs', methods=['GET'])
@cache.cached(timeout=600, query_string=True)
def get_jobs():
    keywords = request.args.get('keywords', '').strip()
    page = request.args.get('page', '1').strip()
    sort_param = request.args.get('sort', 'D').strip()
    province = request.args.get('province', '').strip().upper()
    international_only = request.args.get('international_only', 'false').lower() in ['true', '1', 'yes']
    remote_only = request.args.get('remote', 'false').lower() in ['true', '1', 'yes']

    try:
        page_num = max(1, int(page))
    except ValueError:
        page_num = 1

    params = {
        "sort": sort_param if sort_param in ['D', 'M'] else 'D',
        "page": str(page_num)
    }

    if keywords:
        params["searchstring"] = keywords

    # International candidates flag (fglo=1)
    if international_only:
        params["fglo"] = "1"

    # Valid Canadian province/territory codes
    valid_provinces = {'ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'NT', 'YT', 'NU'}
    if province and province in valid_provinces:
        params["fprov"] = province

    # Remote workplace filter
    if remote_only:
        params["fskl"] = "15141"

    try:
        response = session.get(BASE_URL, params=params, timeout=15)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Extract real total jobs count from Job Bank's #results-count
        total_count = 0
        count_elem = soup.select_one('#results-count, .results-summary .found, .found')
        if count_elem:
            nums = re.findall(r'\d+', count_elem.get_text().replace(',', ''))
            if nums:
                total_count = int(nums[0])

        jobs = []
        articles = soup.find_all('article')
        if not articles:
            # Check for any direct result job items if wrapped differently
            result_links = soup.select('a.resultJobItem')
            articles = [link.find_parent('article') or link.find_parent('div') for link in result_links if link.find_parent()]

        for article in articles:
            if article:
                job_data = parse_job_article(article)
                if job_data:
                    jobs.append(job_data)

        # Compute accurate totalPages
        if total_count > 0:
            total_pages = math.ceil(total_count / 25)
        elif len(jobs) > 0:
            total_pages = page_num + 1
        else:
            total_pages = 1
            jobs = []

        return jsonify({
            "jobs": jobs,
            "totalJobs": total_count if total_count > 0 else len(jobs),
            "totalPages": total_pages,
            "currentPage": page_num,
            "keyword": keywords,
            "province": province,
            "internationalOnly": international_only,
            "remoteOnly": remote_only
        })

    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
        return jsonify({
            "error": "Failed to fetch jobs from Job Bank. Please try again in a moment.",
            "details": str(e)
        }), 502


@app.route('/api/job-details', methods=['GET'])
@cache.cached(timeout=3600, query_string=True)
def get_job_details():
    url = request.args.get('url')
    if not url:
        return jsonify({"error": "URL is required"}), 400

    try:
        # 1. Fetch initial job posting page
        response = session.get(url, timeout=15)
        response.raise_for_status()
        html_content = response.text

        def extract_contact_info(content):
            soup = BeautifulSoup(content, 'html.parser')
            apply_info = []
            seen = set()

            def add(entry):
                entry = entry.strip()
                if entry and entry not in seen and len(entry) > 3:
                    seen.add(entry)
                    apply_info.append(entry)

            all_text = soup.get_text(separator=' ')

            # Blocked administrative/analytics domains
            blocked_domains = {
                'jobbank.gc.ca', 'canada.ca', 'gc.ca', 'sentry.io',
                'w3.org', 'example.com', 'yourdomain.com', 'forces.ca', 'schema.org'
            }

            # 1. Direct Apply on Job Bank indicator
            if soup.find(id=re.compile(r'direct-apply|resumesharing', re.I)) or "Direct Apply" in all_text:
                add("🟢 Direct Apply: Submit your application directly using your Job Bank account.")

            # 2. Extract application emails
            for email in re.findall(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,4}', all_text):
                domain = email.split('@')[-1].lower()
                if domain not in blocked_domains and not any(email.lower().endswith(x) for x in ['.png', '.jpg', '.gif', '.svg']):
                    add(f"📧 Email: {email}")

            # 3. mailto: link scanning
            for a in soup.find_all('a', href=True):
                href = a['href']
                if href.startswith('mailto:') and not href.startswith('mailto:?'):
                    email = href.replace('mailto:', '').split('?')[0].strip()
                    if email and '@' in email and '.' in email:
                        domain = email.split('@')[-1].lower()
                        if domain not in blocked_domains:
                            add(f"📧 Email: {email}")

            # 4. Canadian Phone Numbers
            for phone in re.findall(r'\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}(?!\d)', all_text):
                phone = re.sub(r'\s+', ' ', phone).strip()
                add(f"📞 Phone: {phone}")

            # 5. Application address / By mail
            mail_elem = soup.find(id=re.compile(r'htamail|applyByMail', re.I))
            if mail_elem:
                parent = mail_elem.find_parent(['details', 'div', 'p']) or mail_elem
                mail_text = " ".join(parent.get_text(separator=' ').split())
                if len(mail_text) < 250:
                    add(f"📬 {mail_text}")

            # 6. Structured how to apply section
            hta = soup.find(id='howtoapply')
            if not hta:
                hta = soup.find(class_=re.compile(r'how-to-apply', re.I))

            if hta:
                for elem in hta.find_all(['p', 'li', 'h4']):
                    text = " ".join(elem.get_text(separator=' ').split())
                    for keyword, icon in [
                        ("By mail", "📬"), ("In person", "🏢"),
                        ("By fax", "📠"), ("By phone", "📞"), ("By email", "📧"),
                        ("Online:", "🌐"), ("Website", "🌐")
                    ]:
                        if keyword in text and 5 < len(text) < 250:
                            if "Show how to apply" not in text and "jobbank" not in text.lower():
                                add(f"{icon} {text}")

            return apply_info

        # Extract from initial page
        apply_info = extract_contact_info(html_content)

        # If minimal info found, attempt Jakarta EE JSF AJAX reveal
        if not apply_info or (len(apply_info) == 1 and "Direct Apply" in apply_info[0]):
            soup = BeautifulSoup(html_content, 'html.parser')
            job_id_match = re.search(r'/jobposting/(\d+)', url)
            job_id = job_id_match.group(1) if job_id_match else None

            if job_id:
                vs_tag = soup.find('input', {'name': 'jakarta.faces.ViewState'})
                viewstate = vs_tag.get('value', 'stateless') if vs_tag else 'stateless'

                post_data = {
                    'seekeractivity': 'seekeractivity',
                    'seekeractivity:jobid': job_id,
                    'seekeractivity_SUBMIT': '1',
                    'jakarta.faces.ViewState': viewstate,
                    'jakarta.faces.behavior.event': 'action',
                    'action': 'applynowbutton',
                    'jakarta.faces.source': 'applynowbutton',
                    'jakarta.faces.partial.ajax': 'true',
                    'jakarta.faces.partial.execute': 'applynowbutton jobid',
                    'jakarta.faces.partial.render': 'applynow markappliedgroup'
                }

                post_headers = {
                    "User-Agent": HEADERS["User-Agent"],
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Faces-Request": "partial/ajax",
                    "X-Requested-With": "XMLHttpRequest",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Referer": url
                }

                try:
                    post_res = session.post(url, data=post_data, headers=post_headers, timeout=12)
                    if post_res.status_code == 200:
                        cdata_content = ""
                        try:
                            root = ET.fromstring(post_res.text)
                            for update in root.findall('.//update'):
                                if update.get('id') == 'applynow' and update.text:
                                    cdata_content = update.text
                                    break
                        except Exception:
                            match = re.search(r'<!\[CDATA\[(.*?)\]\]>', post_res.text, re.DOTALL)
                            if match:
                                cdata_content = match.group(1)

                        if cdata_content:
                            post_info = extract_contact_info(cdata_content)
                            if post_info:
                                apply_info.extend(post_info)
                except Exception as post_err:
                    print(f"POST reveal attempt error: {post_err}")

        # Deduplicate while preserving order
        unique_info = []
        seen = set()
        for item in apply_info:
            if item not in seen:
                seen.add(item)
                unique_info.append(item)

        if not unique_info:
            info_string = "ℹ️ Contact info is hidden on this job. Click the blue 'Apply' button to view application instructions on Job Bank."
        else:
            info_string = "\n".join(unique_info)

        # Extract official Canadian Job Bank number from job details page
        jn_match = re.search(r'Job\s*Bank[\s\S]{0,100}#\s*(\d{6,10})', html_content, re.I)
        if not jn_match:
            jn_match = re.search(r'Job\s*(?:Bank)?\s*#\s*(\d{6,10})', html_content, re.I)
        details_job_number = jn_match.group(1) if jn_match else None

        has_cover_letter = bool(re.search(r'cover\s*letter', html_content, re.I))

        return jsonify({
            "applyInfo": info_string,
            "jobNumber": details_job_number,
            "hasCoverLetter": has_cover_letter
        })

    except requests.exceptions.Timeout:
        return jsonify({
            "applyInfo": "⏱ Job Bank took too long to respond. Click 'Apply' to visit the job page directly.",
            "jobNumber": None,
            "hasCoverLetter": False
        })
    except Exception as e:
        print(f"Error fetching job details: {e}")
        return jsonify({
            "applyInfo": "Could not load contact info. Click 'Apply' to visit the job page.",
            "jobNumber": None,
            "hasCoverLetter": False
        })


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
