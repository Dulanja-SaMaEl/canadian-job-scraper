import time
import requests
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

def parse_job_article(article):
    """Parse a single job article tag into a dictionary."""
    try:
        # Job ID
        job_id = article.get("data-jobid", "")
        if not job_id and article.get("id"):
            job_id = article.get("id").replace("article-", "")

        # Link
        link_elem = article.select_one("a.resultJobItem, a")
        url = link_elem["href"] if link_elem and link_elem.has_attr("href") else ""
        if url.startswith("/"):
            url = BASE_DOMAIN + url.split(';')[0]  # Remove session ids if any

        # Title
        title_tag = article.select_one(".noctitle")
        if not title_tag:
             title_tag = article.select_one("h3")
        title = title_tag.text.strip() if title_tag else "Unknown Title"

        # Company
        company = "Unknown Company"
        company_elem = article.select_one(".business, .employer-name, .company")
        if company_elem:
            company = company_elem.text.strip()

        # Location
        location = "Unknown Location"
        location_elem = article.select_one(".location")
        if location_elem:
            for hidden in location_elem.find_all("span", class_="wb-inv"):
                hidden.decompose()
            location = " ".join(location_elem.text.split())
            
        # Salary
        salary = "Not listed"
        salary_elem = article.select_one(".salary, .pay")
        if salary_elem:
            for hidden in salary_elem.find_all("span", class_="wb-inv"):
                hidden.decompose()
            salary = " ".join(salary_elem.text.split()).replace("Salary ", "").replace("Salary", "")
            
        # Date posted
        date_posted = "Unknown Date"
        date_elem = article.select_one(".date, .date-posted")
        if date_elem:
            date_posted = date_elem.text.strip()
            
        # Extract flags (like New, On site, Direct Apply)
        flags = []
        flag_container = article.select_one(".flag")
        if flag_container:
            for span in flag_container.find_all("span", recursive=False):
                # Ignore description spans inside
                for desc in span.find_all("span", class_="description"):
                    desc.decompose()
                flag_text = span.text.strip()
                if flag_text:
                    flags.append(flag_text)

        return {
            "jobId": job_id,
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

@app.route('/api/jobs', methods=['GET'])
@cache.cached(timeout=600, query_string=True)
def get_jobs():
    keywords = request.args.get('keywords', '')
    page = request.args.get('page', '1')
    sort_param = request.args.get('sort', 'D') # Default to Date (D) instead of Match (M)
    
    # 3-second delay to avoid rate limiting
    time.sleep(3)
    
    params = {
        "searchstring": keywords,
        "fglo": "1",  # Canadians and international candidates
        "sort": sort_param,
        "page": page
    }
    
    try:
        response = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        jobs = []
        # Find all job articles
        articles = soup.find_all('article')
        if not articles:
            # Fallback to divs with result class
            articles = soup.select('div[class*="result"]')
            
        for article in articles:
            job_data = parse_job_article(article)
            if job_data:
                jobs.append(job_data)
                
        # Basic pagination estimation (Job Bank often doesn't give a clear total pages easy to parse,
        # but we can check if a "Next" button exists or if we got results)
        total_pages = int(page) + 1 if len(jobs) > 0 else int(page)
        
        return jsonify({
            "jobs": jobs,
            "totalPages": total_pages,
            "currentPage": int(page),
            "keyword": keywords
        })
        
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
        return jsonify({"error": "Failed to fetch jobs from Job Bank", "details": str(e)}), 500

@app.route('/api/job-details', methods=['GET'])
@cache.cached(timeout=3600, query_string=True)
def get_job_details():
    url = request.args.get('url')
    if not url:
        return jsonify({"error": "URL is required"}), 400
        
    try:
        # Use a session so cookies (jsessionid) are automatically carried over
        session = requests.Session()

        # Step 1: GET the job page to acquire the session cookie + form fields
        get_response = session.get(url, headers=HEADERS, timeout=15)
        get_response.raise_for_status()

        soup = BeautifulSoup(get_response.text, 'html.parser')

        # Step 2: Find the hidden "seekeractivity" form and extract all its fields
        apply_form = soup.find('form', id='seekeractivity')

        if apply_form:
            form_data = {}
            for inp in apply_form.find_all('input', type='hidden'):
                if inp.get('name'):
                    form_data[inp['name']] = inp.get('value', '')

            # The action URL contains the jsessionid token
            form_action = apply_form.get('action', '')
            if form_action.startswith('/'):
                post_url = BASE_DOMAIN + form_action
            else:
                post_url = form_action

            post_headers = {**HEADERS,
                "Referer": url,
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Origin": BASE_DOMAIN,
            }

            # Step 3: POST the form — this mimics clicking "Show how to apply"
            post_response = session.post(post_url, data=form_data, headers=post_headers, timeout=15)

            if post_response.ok and len(post_response.text) > 100:
                soup = BeautifulSoup(post_response.text, 'html.parser')

        # Step 4: Parse the (now updated) page for all contact info
        apply_info = []

        # First: grab all mailto links anywhere on the page (highest priority)
        # Skip template links like mailto:?Subject=... which have no actual email
        for a in soup.find_all('a', href=True):
            href = a['href']
            if href.startswith('mailto:') and not href.startswith('mailto:?'):
                email = href.replace('mailto:', '').split('?')[0].strip()
                if email and '@' in email:
                    entry = f"📧 Email: {email}"
                    if entry not in apply_info:
                        apply_info.append(entry)

        # Find the how-to-apply section for phone/address/fax
        how_to_apply_section = soup.find(id='howtoapply')
        if not how_to_apply_section:
            for h in soup.find_all(['h2', 'h3', 'h4']):
                if h.text and "how to apply" in h.text.lower():
                    how_to_apply_section = h.find_parent(['section', 'div', 'article'])
                    break

        if how_to_apply_section:
            for elem in how_to_apply_section.find_all(['p', 'div', 'li']):
                text = " ".join(elem.get_text(separator=' ').split())
                has_contact = any(k in text for k in ["By phone", "By mail", "In person", "By fax", "By email"])
                if has_contact and "Show how to apply" not in text and "jobbank" not in text.lower() and len(text) > 5:
                    if "By phone" in text:
                        text = "📞 " + text
                    elif "By mail" in text or "In person" in text:
                        text = "📬 " + text
                    elif "By fax" in text:
                        text = "📠 " + text
                    elif "By email" in text:
                        text = "📧 " + text
                    if text not in apply_info:
                        apply_info.append(text)

        info_string = "\n".join(apply_info) if apply_info else "Contact info hidden. Job Bank requires login to reveal this employer's contact details."

        return jsonify({"applyInfo": info_string})

    except Exception as e:
        print(f"Error fetching details: {e}")
        return jsonify({"applyInfo": f"Could not load contact info: {str(e)}"})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
