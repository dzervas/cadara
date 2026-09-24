public:
  // Production-callable semantic query over native neutral curves. The caller
  // owns both input handles; the returned JSON owns no native object.
  static std::string QueryJson(
    const Handle(Geom2d_Curve)& first,
    const double firstStart,
    const double firstEnd,
    const Handle(Geom2d_Curve)& second,
    const double secondStart,
    const double secondEnd,
    const bool selfQuery,
    const double tolerance
  ) {
    if (first.IsNull() || second.IsNull()) {
      return Failure("nativeFailure", "null-curve");
    }
    if (!FiniteDomain(firstStart, firstEnd) || !FiniteDomain(secondStart, secondEnd)) {
      return Failure("uncertain", "invalid-domain");
    }

    if (!selfQuery) {
      const Handle(Geom2d_Circle) firstCircle = Handle(Geom2d_Circle)::DownCast(Unwrap(first));
      const Handle(Geom2d_Circle) secondCircle = Handle(Geom2d_Circle)::DownCast(Unwrap(second));
      if (!firstCircle.IsNull() && !secondCircle.IsNull()) {
        return QueryCircles(
          first, firstStart, firstEnd, firstCircle,
          second, secondStart, secondEnd, secondCircle
        );
      }

      const StructuralBezierMatch match = MatchBeziers(first, second);
      if (match.matched) {
        return QueryStructuralBezierOverlap(
          first, firstStart, firstEnd,
          second, secondStart, secondEnd,
          match.reversed,
          match.injective
        );
      }
    }

    return QueryGInter(
      first, firstStart, firstEnd,
      second, secondStart, secondEnd,
      selfQuery, tolerance
    );
  }

private:
  // Minimal signed integer used only for exact binary64 dyadic arithmetic.
  // This keeps the shim self-contained and bounded to the admitted proofs.
  struct BigInt {
    bool negative;
    std::vector<std::uint32_t> words;

    BigInt() : negative(false) {}

    explicit BigInt(const std::uint64_t value, const bool isNegative = false)
      : negative(isNegative && value != 0) {
      if (value != 0) {
        words.push_back(static_cast<std::uint32_t>(value));
        const std::uint32_t high = static_cast<std::uint32_t>(value >> 32);
        if (high != 0) words.push_back(high);
      }
    }

    void Normalize() {
      while (!words.empty() && words.back() == 0) words.pop_back();
      if (words.empty()) negative = false;
    }

    BigInt Negated() const {
      BigInt result = *this;
      if (!result.words.empty()) result.negative = !result.negative;
      return result;
    }

    static int CompareMagnitude(const BigInt& left, const BigInt& right) {
      if (left.words.size() != right.words.size()) {
        return left.words.size() < right.words.size() ? -1 : 1;
      }
      for (std::size_t i = left.words.size(); i-- > 0;) {
        if (left.words[i] != right.words[i]) {
          return left.words[i] < right.words[i] ? -1 : 1;
        }
      }
      return 0;
    }

    static int Compare(const BigInt& left, const BigInt& right) {
      if (left.negative != right.negative) return left.negative ? -1 : 1;
      const int magnitude = CompareMagnitude(left, right);
      return left.negative ? -magnitude : magnitude;
    }

    static BigInt AddMagnitude(const BigInt& left, const BigInt& right) {
      BigInt result;
      const std::size_t count = std::max(left.words.size(), right.words.size());
      result.words.resize(count);
      std::uint64_t carry = 0;
      for (std::size_t i = 0; i < count; ++i) {
        const std::uint64_t sum = carry +
          (i < left.words.size() ? left.words[i] : 0) +
          (i < right.words.size() ? right.words[i] : 0);
        result.words[i] = static_cast<std::uint32_t>(sum);
        carry = sum >> 32;
      }
      if (carry != 0) result.words.push_back(static_cast<std::uint32_t>(carry));
      return result;
    }

    static BigInt SubtractMagnitude(const BigInt& larger, const BigInt& smaller) {
      BigInt result;
      result.words.resize(larger.words.size());
      std::uint64_t borrow = 0;
      for (std::size_t i = 0; i < larger.words.size(); ++i) {
        const std::uint64_t left = larger.words[i];
        const std::uint64_t right =
          (i < smaller.words.size() ? smaller.words[i] : 0) + borrow;
        result.words[i] = static_cast<std::uint32_t>(left - right);
        borrow = left < right ? 1 : 0;
      }
      result.Normalize();
      return result;
    }

    static BigInt Add(const BigInt& left, const BigInt& right) {
      if (left.negative == right.negative) {
        BigInt result = AddMagnitude(left, right);
        result.negative = left.negative && !result.words.empty();
        return result;
      }
      const int magnitude = CompareMagnitude(left, right);
      if (magnitude == 0) return BigInt();
      const BigInt& larger = magnitude > 0 ? left : right;
      const BigInt& smaller = magnitude > 0 ? right : left;
      BigInt result = SubtractMagnitude(larger, smaller);
      result.negative = larger.negative;
      return result;
    }

    BigInt ShiftLeft(const int bits) const {
      if (words.empty() || bits == 0) return *this;
      BigInt result;
      result.negative = negative;
      const std::size_t wordShift = static_cast<std::size_t>(bits / 32);
      const int bitShift = bits % 32;
      result.words.assign(wordShift, 0);
      std::uint64_t carry = 0;
      for (const std::uint32_t word : words) {
        const std::uint64_t shifted = (std::uint64_t(word) << bitShift) | carry;
        result.words.push_back(static_cast<std::uint32_t>(shifted));
        carry = shifted >> 32;
      }
      if (carry != 0) result.words.push_back(static_cast<std::uint32_t>(carry));
      return result;
    }

    static BigInt Multiply(const BigInt& left, const BigInt& right) {
      if (left.words.empty() || right.words.empty()) return BigInt();
      BigInt result;
      result.negative = left.negative != right.negative;
      result.words.assign(left.words.size() + right.words.size(), 0);
      for (std::size_t i = 0; i < left.words.size(); ++i) {
        std::uint64_t carry = 0;
        for (std::size_t j = 0; j < right.words.size(); ++j) {
          const std::size_t index = i + j;
          const std::uint64_t product = std::uint64_t(left.words[i]) * right.words[j] +
            result.words[index] + carry;
          result.words[index] = static_cast<std::uint32_t>(product);
          carry = product >> 32;
        }
        std::size_t index = i + right.words.size();
        while (carry != 0) {
          const std::uint64_t sum = std::uint64_t(result.words[index]) + carry;
          result.words[index] = static_cast<std::uint32_t>(sum);
          carry = sum >> 32;
          ++index;
          if (index == result.words.size() && carry != 0) result.words.push_back(0);
        }
      }
      result.Normalize();
      return result;
    }

    int HighestBit() const {
      if (words.empty()) return -1;
      const std::uint32_t high = words.back();
      int bit = 31;
      while ((high & (std::uint32_t(1) << bit)) == 0) --bit;
      return static_cast<int>((words.size() - 1) * 32) + bit;
    }

    bool Bit(const int index) const {
      if (index < 0) return false;
      const std::size_t word = static_cast<std::size_t>(index / 32);
      return word < words.size() &&
        (words[word] & (std::uint32_t(1) << (index % 32))) != 0;
    }

    bool AnyBitsBelow(const int count) const {
      if (count <= 0) return false;
      const std::size_t wholeWords = static_cast<std::size_t>(count / 32);
      const std::size_t checkedWords = std::min(wholeWords, words.size());
      for (std::size_t i = 0; i < checkedWords; ++i) {
        if (words[i] != 0) return true;
      }
      const int remaining = count % 32;
      if (remaining == 0 || wholeWords >= words.size()) return false;
      const std::uint32_t mask = (std::uint32_t(1) << remaining) - 1;
      return (words[wholeWords] & mask) != 0;
    }

    std::uint64_t ShiftedToUint64(const int shift) const {
      std::uint64_t result = 0;
      const int high = HighestBit();
      for (int bit = high; bit >= shift; --bit) {
        result = (result << 1) | (Bit(bit) ? 1 : 0);
      }
      return result;
    }
  };

  struct Dyadic {
    BigInt numerator;
    int exponent;

    static Dyadic FromDouble(const double value) {
      std::uint64_t bits = 0;
      std::memcpy(&bits, &value, sizeof(bits));
      const bool negative = (bits >> 63) != 0;
      const std::uint64_t fraction = bits & ((std::uint64_t(1) << 52) - 1);
      const int biasedExponent = int((bits >> 52) & 0x7ff);
      std::uint64_t numerator;
      int exponent;
      if (biasedExponent == 0) {
        numerator = fraction;
        exponent = -1074;
      } else {
        numerator = (std::uint64_t(1) << 52) | fraction;
        exponent = biasedExponent - 1023 - 52;
      }
      return {BigInt(numerator, negative), exponent};
    }
  };

  struct RoundedDouble {
    double value;
    bool exact;
  };

  struct StructuralBezierMatch {
    bool matched;
    bool reversed;
    bool injective;
  };

  static bool FiniteDomain(const double start, const double end) {
    return std::isfinite(start) && std::isfinite(end) && start <= end;
  }

  static Handle(Geom2d_Curve) Unwrap(const Handle(Geom2d_Curve)& curve) {
    Handle(Geom2d_Curve) current = curve;
    for (int depth = 0; depth < 16; ++depth) {
      const Handle(Geom2d_TrimmedCurve) trimmed = Handle(Geom2d_TrimmedCurve)::DownCast(current);
      if (trimmed.IsNull()) return current;
      current = trimmed->BasisCurve();
    }
    return Handle(Geom2d_Curve)();
  }

  static int Compare(const Dyadic& left, const Dyadic& right) {
    if (left.exponent == right.exponent) {
      return BigInt::Compare(left.numerator, right.numerator);
    }
    const int exponent = std::min(left.exponent, right.exponent);
    const BigInt l = left.numerator.ShiftLeft(left.exponent - exponent);
    const BigInt r = right.numerator.ShiftLeft(right.exponent - exponent);
    return BigInt::Compare(l, r);
  }

  static Dyadic Add(const Dyadic& left, const Dyadic& right) {
    if (left.numerator.words.empty()) return right;
    if (right.numerator.words.empty()) return left;
    const int exponent = std::min(left.exponent, right.exponent);
    return {
      BigInt::Add(
        left.numerator.ShiftLeft(left.exponent - exponent),
        right.numerator.ShiftLeft(right.exponent - exponent)
      ),
      exponent
    };
  }

  static Dyadic Subtract(const Dyadic& left, const Dyadic& right) {
    return Add(left, {right.numerator.Negated(), right.exponent});
  }

  static Dyadic Multiply(const Dyadic& left, const Dyadic& right) {
    return {
      BigInt::Multiply(left.numerator, right.numerator),
      left.exponent + right.exponent
    };
  }

  static RoundedDouble ToDouble(const Dyadic& value) {
    const int high = value.numerator.HighestBit();
    if (high < 0) return {0, true};

    // Retain the binary64 significand, or the available subnormal bits. The
    // guard/sticky decision considers every discarded limb and implements
    // round-to-nearest, ties-to-even rather than truncating a word prefix.
    const int discard = std::max(high - 52, -1074 - value.exponent);
    std::uint64_t magnitude;
    bool exact = true;
    int resultExponent;
    if (discard <= 0) {
      magnitude = value.numerator.ShiftedToUint64(0);
      resultExponent = value.exponent;
    } else {
      magnitude = discard > high ? 0 : value.numerator.ShiftedToUint64(discard);
      const bool guard = value.numerator.Bit(discard - 1);
      const bool sticky = value.numerator.AnyBitsBelow(discard - 1);
      exact = !guard && !sticky;
      if (guard && (sticky || (magnitude & 1) != 0)) ++magnitude;
      resultExponent = value.exponent + discard;
    }

    double result = std::ldexp(static_cast<double>(magnitude), resultExponent);
    if (value.numerator.negative) result = -result;
    if (!std::isfinite(result) || result == 0) exact = false;
    return {result, exact};
  }

  static bool AliasesDistinctEndpoint(
    const Dyadic& exact,
    const double rounded,
    const Dyadic& start,
    const double startValue,
    const Dyadic& end,
    const double endValue
  ) {
    return (Compare(exact, start) != 0 && rounded == startValue) ||
      (Compare(exact, end) != 0 && rounded == endValue);
  }

  static bool SameBits(const double left, const double right) {
    std::uint64_t leftBits = 0, rightBits = 0;
    std::memcpy(&leftBits, &left, sizeof(leftBits));
    std::memcpy(&rightBits, &right, sizeof(rightBits));
    return leftBits == rightBits;
  }

  static StructuralBezierMatch MatchBeziers(
    const Handle(Geom2d_Curve)& first,
    const Handle(Geom2d_Curve)& second
  ) {
    const Handle(Geom2d_BezierCurve) a = Handle(Geom2d_BezierCurve)::DownCast(Unwrap(first));
    const Handle(Geom2d_BezierCurve) b = Handle(Geom2d_BezierCurve)::DownCast(Unwrap(second));
    if (a.IsNull() || b.IsNull() || a->Degree() != 3 || b->Degree() != 3 ||
        a->NbPoles() != 4 || b->NbPoles() != 4 || a->IsRational() != b->IsRational()) {
      return {false, false, false};
    }
    const auto poleEqual = [&](const int ai, const int bi) {
      const gp_Pnt2d ap = a->Pole(ai), bp = b->Pole(bi);
      if (!std::isfinite(ap.X()) || !std::isfinite(ap.Y()) ||
          !std::isfinite(bp.X()) || !std::isfinite(bp.Y()) ||
          !SameBits(ap.X(), bp.X()) || !SameBits(ap.Y(), bp.Y())) return false;
      if (!a->IsRational()) return true;
      return std::isfinite(a->Weight(ai)) && std::isfinite(b->Weight(bi)) &&
        SameBits(a->Weight(ai), b->Weight(bi));
    };
    bool same = true, reversed = true;
    for (int i = 1; i <= 4; ++i) {
      same = same && poleEqual(i, i);
      reversed = reversed && poleEqual(i, 5 - i);
    }
    const auto coordinateMonotone = [&](const bool xCoordinate) {
      bool nondecreasing = true, nonincreasing = true, strict = false;
      double previous = xCoordinate ? a->Pole(1).X() : a->Pole(1).Y();
      for (int i = 2; i <= 4; ++i) {
        const double current = xCoordinate ? a->Pole(i).X() : a->Pole(i).Y();
        nondecreasing = nondecreasing && current >= previous;
        nonincreasing = nonincreasing && current <= previous;
        strict = strict || current != previous;
        previous = current;
      }
      return strict && (nondecreasing || nonincreasing);
    };
    const bool injective = coordinateMonotone(true) || coordinateMonotone(false);
    if (same) return {true, false, injective};
    if (reversed) return {true, true, injective};
    return {false, false, false};
  }

  static std::string QueryStructuralBezierOverlap(
    const Handle(Geom2d_Curve)& first,
    const double firstStart,
    const double firstEnd,
    const Handle(Geom2d_Curve)& second,
    const double secondStart,
    const double secondEnd,
    const bool reversed,
    const bool injective
  ) {
    const Dyadic a0 = Dyadic::FromDouble(firstStart);
    const Dyadic a1 = Dyadic::FromDouble(firstEnd);
    const Dyadic b0 = Dyadic::FromDouble(secondStart);
    const Dyadic b1 = Dyadic::FromDouble(secondEnd);
    const Handle(Geom2d_Curve) firstBasis = Unwrap(first);
    if (firstBasis.IsNull()) {
      return Failure("uncertain", "trim-nesting-limit");
    }
    const Dyadic basisSum = Add(
      Dyadic::FromDouble(firstBasis->FirstParameter()),
      Dyadic::FromDouble(firstBasis->LastParameter())
    );
    const Dyadic mappedB0 = reversed ? Subtract(basisSum, b1) : b0;
    const Dyadic mappedB1 = reversed ? Subtract(basisSum, b0) : b1;
    const Dyadic low = Compare(a0, mappedB0) >= 0 ? a0 : mappedB0;
    const Dyadic high = Compare(a1, mappedB1) <= 0 ? a1 : mappedB1;
    const int width = Compare(low, high);
    if (width >= 0) {
      return Failure("uncertain", width == 0 ? "structural-point-contact" : "structural-domains-disjoint");
    }

    const Dyadic exactV0 = reversed ? Subtract(basisSum, low) : low;
    const Dyadic exactV1 = reversed ? Subtract(basisSum, high) : high;
    const RoundedDouble u0 = ToDouble(low), u1 = ToDouble(high);
    const RoundedDouble v0 = ToDouble(exactV0), v1 = ToDouble(exactV1);
    if (!std::isfinite(u0.value) || !std::isfinite(u1.value) ||
        !std::isfinite(v0.value) || !std::isfinite(v1.value) ||
        !(u0.value < u1.value) ||
        (reversed ? !(v1.value < v0.value) : !(v0.value < v1.value)) ||
        AliasesDistinctEndpoint(low, u0.value, a0, firstStart, a1, firstEnd) ||
        AliasesDistinctEndpoint(high, u1.value, a0, firstStart, a1, firstEnd) ||
        AliasesDistinctEndpoint(exactV0, v0.value, b0, secondStart, b1, secondEnd) ||
        AliasesDistinctEndpoint(exactV1, v1.value, b0, secondStart, b1, secondEnd)) {
      return Failure("uncertain", "structural-domain-not-representable");
    }

    const bool endpointsExact = u0.exact && u1.exact && v0.exact && v1.exact;
    const char* status = injective && endpointsExact ? "verified" : "candidate";
    const char* reason = nullptr;
    if (!injective && !endpointsExact) {
      reason = "structural-rounded-endpoints-and-noninjective-basis-require-certification";
    } else if (!injective) {
      reason = "structural-component-only-noninjective-basis";
    } else if (!endpointsExact) {
      reason = "structural-rounded-endpoints-require-domain-certification";
    }
    return SegmentResult(
      status, "structuralBezierOverlap", reversed,
      first, u0.value, second, v0.value,
      first, u1.value, second, v1.value,
      reason
    );
  }

  static std::string QueryCircles(
    const Handle(Geom2d_Curve)& first,
    const double firstStart,
    const double firstEnd,
    const Handle(Geom2d_Circle)& firstCircle,
    const Handle(Geom2d_Curve)& second,
    const double secondStart,
    const double secondEnd,
    const Handle(Geom2d_Circle)& secondCircle
  ) {
    const gp_Circ2d a = firstCircle->Circ2d(), b = secondCircle->Circ2d();
    const double ar = a.Radius(), br = b.Radius();
    if (!std::isfinite(ar) || !std::isfinite(br) || ar <= 0 || br <= 0 ||
        !std::isfinite(a.Location().X()) || !std::isfinite(a.Location().Y()) ||
        !std::isfinite(b.Location().X()) || !std::isfinite(b.Location().Y())) {
      return Failure("uncertain", "invalid-circle");
    }
    const Dyadic dx = Subtract(Dyadic::FromDouble(a.Location().X()), Dyadic::FromDouble(b.Location().X()));
    const Dyadic dy = Subtract(Dyadic::FromDouble(a.Location().Y()), Dyadic::FromDouble(b.Location().Y()));
    const Dyadic d2 = Add(Multiply(dx, dx), Multiply(dy, dy));
    const Dyadic sum = Add(Dyadic::FromDouble(ar), Dyadic::FromDouble(br));
    const Dyadic difference = Subtract(Dyadic::FromDouble(ar), Dyadic::FromDouble(br));
    const Dyadic sum2 = Multiply(sum, sum), difference2 = Multiply(difference, difference);
    const int outer = Compare(d2, sum2), inner = Compare(d2, difference2);
    if (outer > 0 || inner < 0) return EmptyResult("IntAna2d");
    if (Compare(d2, Dyadic::FromDouble(0)) == 0 && inner == 0) {
      return Failure("uncertain", "coincident-circles");
    }
    const int expectedPoints = (outer == 0 || inner == 0) ? 1 : 2;

    IntAna2d_AnaIntersection intersection(a, b);
    if (!intersection.IsDone()) return Failure("nativeFailure", "IntAna2d-not-done");
    if (intersection.IsEmpty() || intersection.NbPoints() != expectedPoints) {
      return Failure("uncertain", "IntAna2d-count-disagrees-with-exact-guard");
    }
    std::ostringstream out;
    // IntAna2d proves support-level classification only. Its canonical angles
    // are candidates: requested arc/full-turn/winding membership remains with
    // the certified TypeScript angular-domain owner.
    out << Prefix("candidate", "IntAna2d")
        << ",\"reason\":\"analytic-support-candidates-require-domain-certification\""
        << ",\"points\":[";
    for (int i = 1; i <= intersection.NbPoints(); ++i) {
      const IntAna2d_IntPoint point = intersection.Point(i);
      const double u = point.ParamOnFirst(), v = point.ParamOnSecond();
      if (!std::isfinite(u) || !std::isfinite(v)) {
        return Failure("uncertain", "nonfinite-analytic-parameter");
      }
      if (i != 1) out << ',';
      WritePoint(out, first, u, second, v, point.Value());
    }
    out << "],\"segments\":[]}";
    return out.str();
  }

  static std::string QueryGInter(
    const Handle(Geom2d_Curve)& first,
    const double firstStart,
    const double firstEnd,
    const Handle(Geom2d_Curve)& second,
    const double secondStart,
    const double secondEnd,
    const bool selfQuery,
    const double tolerance
  ) {
    if (!std::isfinite(tolerance) || tolerance <= 0) return Failure("uncertain", "invalid-tolerance");
    Geom2dAdaptor_Curve firstAdaptor(first, firstStart, firstEnd);
    Geom2dInt_GInter intersection;
    if (selfQuery) {
      intersection.Perform(firstAdaptor, tolerance, tolerance);
    } else {
      Geom2dAdaptor_Curve secondAdaptor(second, secondStart, secondEnd);
      intersection.Perform(firstAdaptor, secondAdaptor, tolerance, tolerance);
    }
    if (!intersection.IsDone()) return Failure("nativeFailure", "GInter-not-done");
    std::ostringstream out;
    // GInter is only a candidate source. Production must retain its independent
    // completeness/incidence verifier before promoting this payload.
    out << Prefix("candidate", "Geom2dInt_GInter") << ",\"points\":[";
    for (int i = 1; i <= intersection.NbPoints(); ++i) {
      if (i != 1) out << ',';
      const IntRes2d_IntersectionPoint point = intersection.Point(i);
      WritePoint(out, first, point.ParamOnFirst(), second, point.ParamOnSecond(), point.Value());
    }
    out << "],\"segments\":[";
    for (int i = 1; i <= intersection.NbSegments(); ++i) {
      if (i != 1) out << ',';
      const IntRes2d_IntersectionSegment segment = intersection.Segment(i);
      out << "{\"opposite\":" << (segment.IsOpposite() ? "true" : "false");
      out << ",\"first\":";
      if (segment.HasFirstPoint()) {
        const IntRes2d_IntersectionPoint point = segment.FirstPoint();
        WritePoint(out, first, point.ParamOnFirst(), second, point.ParamOnSecond(), point.Value());
      } else {
        out << "null";
      }
      out << ",\"last\":";
      if (segment.HasLastPoint()) {
        const IntRes2d_IntersectionPoint point = segment.LastPoint();
        WritePoint(out, first, point.ParamOnFirst(), second, point.ParamOnSecond(), point.Value());
      } else {
        out << "null";
      }
      out << '}';
    }
    out << "]}";
    return out.str();
  }

  static std::string SegmentResult(
    const char* status,
    const char* backend,
    const bool opposite,
    const Handle(Geom2d_Curve)& first,
    const double firstU,
    const Handle(Geom2d_Curve)& second,
    const double firstV,
    const Handle(Geom2d_Curve)& firstLastCurve,
    const double lastU,
    const Handle(Geom2d_Curve)& secondLastCurve,
    const double lastV,
    const char* reason
  ) {
    std::ostringstream out;
    out << Prefix(status, backend);
    if (reason != nullptr) out << ",\"reason\":\"" << reason << "\"";
    out << ",\"points\":[],\"segments\":[{\"opposite\":"
        << (opposite ? "true" : "false") << ",\"first\":";
    WriteEvaluatedPoint(out, first, firstU, second, firstV);
    out << ",\"last\":";
    WriteEvaluatedPoint(out, firstLastCurve, lastU, secondLastCurve, lastV);
    out << "}]}";
    return out.str();
  }

  static std::string EmptyResult(const char* backend) {
    return Prefix("verified", backend) + ",\"points\":[],\"segments\":[]}";
  }

  static std::string Failure(const char* status, const char* reason) {
    return Prefix(status, "none") + ",\"reason\":\"" + reason + "\",\"points\":[],\"segments\":[]}";
  }

  static std::string Prefix(const char* status, const char* backend) {
    return std::string("{\"schemaVersion\":\"cadara-neutral-curve-query/v1\",\"status\":\"") +
      status + "\",\"backend\":\"" + backend + "\"";
  }

  static void WriteNumber(std::ostringstream& out, const double value) {
    out << std::setprecision(std::numeric_limits<double>::max_digits10) << value;
  }

  static void WriteXY(std::ostringstream& out, const gp_Pnt2d& point) {
    out << '['; WriteNumber(out, point.X()); out << ','; WriteNumber(out, point.Y()); out << ']';
  }

  static void WriteEvaluatedPoint(
    std::ostringstream& out,
    const Handle(Geom2d_Curve)& first,
    const double u,
    const Handle(Geom2d_Curve)& second,
    const double v
  ) {
    const gp_Pnt2d a = first->Value(u), b = second->Value(v);
    const gp_Pnt2d reported((a.X() + b.X()) / 2, (a.Y() + b.Y()) / 2);
    out << "{\"u\":"; WriteNumber(out, u);
    out << ",\"v\":"; WriteNumber(out, v);
    out << ",\"first\":"; WriteXY(out, a);
    out << ",\"second\":"; WriteXY(out, b);
    out << ",\"reported\":"; WriteXY(out, reported);
    out << '}';
  }

  static void WritePoint(
    std::ostringstream& out,
    const Handle(Geom2d_Curve)& first,
    const double u,
    const Handle(Geom2d_Curve)& second,
    const double v,
    const gp_Pnt2d& reported
  ) {
    const gp_Pnt2d a = first->Value(u), b = second->Value(v);
    out << "{\"u\":"; WriteNumber(out, u);
    out << ",\"v\":"; WriteNumber(out, v);
    out << ",\"first\":"; WriteXY(out, a);
    out << ",\"second\":"; WriteXY(out, b);
    out << ",\"reported\":"; WriteXY(out, reported);
    out << '}';
  }
