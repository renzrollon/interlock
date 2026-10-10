using Acme.Core;

public class DeviceMetricSourceTests
{
    private readonly IMetricSource _shared;

    [Fact]
    public void Reads_metric()
    {
        var source = new DeviceMetricSource();
    }

    [Theory]
    [InlineData(1.0)]
    [InlineData(2.0)]
    public void Scales(double v)
    {
    }

    [Fact(Skip = "flaky")] public async Task Skipped() { }

    [Obsolete]
    public void Old()
    {
    }

    [Test]
    public void Nunit_style()
    {
    }

    [TestMethod]
    public void Mstest_style()
    {
    }

    public void Helper()
    {
    }
}
